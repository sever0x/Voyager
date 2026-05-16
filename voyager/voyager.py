import copy
import json
import os
import time
from typing import Dict

import voyager.utils as U
from .env import VoyagerEnv
from .utils.llm_factory import create_llm, create_embeddings

from .agents import ActionAgent
from .agents import CriticAgent
from .agents import CurriculumAgent
from .agents import SkillManager
from .agents import SurvivalMemory

_RAW_MEATS = frozenset({"beef", "porkchop", "mutton", "chicken", "salmon", "cod"})
_WEAPON_NAMES = frozenset({
    "wooden_sword", "stone_sword", "iron_sword", "golden_sword",
    "diamond_sword", "netherite_sword", "bow", "crossbow",
})
_ANIMAL_MOBS = frozenset({"cow", "pig", "chicken", "sheep", "rabbit"})


# TODO: remove event memory
class Voyager:
    def __init__(
        self,
        mc_port: int = None,
        mc_version: str = None,
        azure_login: Dict[str, str] = None,
        server_port: int = 3000,
        openai_api_key: str = None,
        llm_provider: str = "openai",
        embedding_provider: str = "openai",
        env_wait_ticks: int = 20,
        env_request_timeout: int = 600,
        max_iterations: int = 160,
        reset_placed_if_failed: bool = False,
        action_agent_model_name: str = "gpt-5.4-mini",
        action_agent_temperature: float = 0,
        action_agent_task_max_retries: int = 4,
        action_agent_show_chat_log: bool = True,
        action_agent_show_execution_error: bool = True,
        action_agent_include_advanced_primitives: bool = True,
        curriculum_agent_model_name: str = "gpt-5.4-mini",
        curriculum_agent_temperature: float = 0,
        curriculum_agent_qa_model_name: str = "gpt-5.4-nano",
        curriculum_agent_qa_temperature: float = 0,
        curriculum_agent_warm_up: Dict[str, int] = None,
        curriculum_agent_core_inventory_items: str = r".*_log|.*_planks|stick|crafting_table|furnace"
        r"|cobblestone|dirt|coal|.*_pickaxe|.*_sword|.*_axe",
        curriculum_agent_mode: str = "auto",
        critic_agent_model_name: str = "gpt-5.4-mini",
        critic_agent_temperature: float = 0,
        critic_agent_mode: str = "auto",
        skill_manager_model_name: str = "gpt-5.4-nano",
        skill_manager_temperature: float = 0,
        skill_manager_retrieval_top_k: int = 5,
        embedding_model_name: str = "text-embedding-3-small",
        openai_api_request_timeout: int = 240,
        ckpt_dir: str = "ckpt",
        skill_library_dir: str = None,
        resume: bool = False,
        reset_mode: str = "hard",
    ):
        """
        The main class for Voyager.
        Action agent is the iterative prompting mechanism in paper.
        Curriculum agent is the automatic curriculum in paper.
        Critic agent is the self-verification in paper.
        Skill manager is the skill library in paper.
        :param mc_port: minecraft in-game port
        :param azure_login: minecraft login config
        :param server_port: mineflayer port
        :param openai_api_key: openai api key
        :param env_wait_ticks: how many ticks at the end each step will wait, if you found some chat log missing,
        you should increase this value
        :param env_request_timeout: how many seconds to wait for each step, if the code execution exceeds this time,
        python side will terminate the connection and need to be resumed
        :param reset_placed_if_failed: whether to reset placed blocks if failed, useful for building task
        :param action_agent_model_name: action agent model name
        :param action_agent_temperature: action agent temperature
        :param action_agent_task_max_retries: how many times to retry if failed
        :param curriculum_agent_model_name: curriculum agent model name
        :param curriculum_agent_temperature: curriculum agent temperature
        :param curriculum_agent_qa_model_name: curriculum agent qa model name
        :param curriculum_agent_qa_temperature: curriculum agent qa temperature
        :param curriculum_agent_warm_up: info will show in curriculum human message
        if completed task larger than the value in dict, available keys are:
        {
            "context": int,
            "biome": int,
            "time": int,
            "other_blocks": int,
            "nearby_entities": int,
            "health": int,
            "hunger": int,
            "position": int,
            "equipment": int,
            "chests": int,
            "optional_inventory_items": int,
        }
        :param curriculum_agent_core_inventory_items: only show these items in inventory before optional_inventory_items
        reached in warm up
        :param curriculum_agent_mode: "auto" for automatic curriculum, "manual" for human curriculum
        :param critic_agent_model_name: critic agent model name
        :param critic_agent_temperature: critic agent temperature
        :param critic_agent_mode: "auto" for automatic critic ,"manual" for human critic
        :param skill_manager_model_name: skill manager model name
        :param skill_manager_temperature: skill manager temperature
        :param skill_manager_retrieval_top_k: how many skills to retrieve for each task
        :param openai_api_request_timeout: how many seconds to wait for openai api
        :param ckpt_dir: checkpoint dir
        :param skill_library_dir: skill library dir
        :param resume: whether to resume from checkpoint
        :param reset_mode: "hard" clears inventory and kills bot between tasks (Creative default),
            "soft" reconnects without clearing inventory (Survival default),
            "none" continues without any reset (future use)
        """
        # init env
        self.env = VoyagerEnv(
            mc_port=mc_port,
            mc_version=mc_version,
            azure_login=azure_login,
            server_port=server_port,
            request_timeout=env_request_timeout,
        )
        self.env_wait_ticks = env_wait_ticks
        self.reset_placed_if_failed = reset_placed_if_failed
        self.max_iterations = max_iterations

        if openai_api_key:
            os.environ["OPENAI_API_KEY"] = openai_api_key

        # build LLM and embeddings objects once; pass into agents
        _llm_kwargs = {"request_timeout": openai_api_request_timeout}
        action_llm = create_llm(
            llm_provider, action_agent_model_name,
            temperature=action_agent_temperature, **_llm_kwargs,
        )
        curriculum_llm = create_llm(
            llm_provider, curriculum_agent_model_name,
            temperature=curriculum_agent_temperature, **_llm_kwargs,
        )
        curriculum_qa_llm = create_llm(
            llm_provider, curriculum_agent_qa_model_name,
            temperature=curriculum_agent_qa_temperature, **_llm_kwargs,
        )
        critic_llm = create_llm(
            llm_provider, critic_agent_model_name,
            temperature=critic_agent_temperature, **_llm_kwargs,
        )
        skill_llm = create_llm(
            llm_provider, skill_manager_model_name,
            temperature=skill_manager_temperature, **_llm_kwargs,
        )
        embeddings = create_embeddings(embedding_provider, embedding_model_name)

        # init agents
        self.action_agent = ActionAgent(
            llm=action_llm,
            ckpt_dir=ckpt_dir,
            resume=resume,
            chat_log=action_agent_show_chat_log,
            execution_error=action_agent_show_execution_error,
            include_advanced_primitives=action_agent_include_advanced_primitives,
        )
        self.action_agent_task_max_retries = action_agent_task_max_retries
        self.curriculum_agent = CurriculumAgent(
            llm=curriculum_llm,
            qa_llm=curriculum_qa_llm,
            embeddings=embeddings,
            ckpt_dir=ckpt_dir,
            resume=resume,
            mode=curriculum_agent_mode,
            warm_up=curriculum_agent_warm_up,
            core_inventory_items=curriculum_agent_core_inventory_items,
        )
        self.critic_agent = CriticAgent(
            llm=critic_llm,
            mode=critic_agent_mode,
        )
        self.skill_manager = SkillManager(
            llm=skill_llm,
            embeddings=embeddings,
            retrieval_top_k=skill_manager_retrieval_top_k,
            ckpt_dir=skill_library_dir if skill_library_dir else ckpt_dir,
            resume=True if resume or skill_library_dir else False,
        )
        self.survival_memory = SurvivalMemory(
            llm=skill_llm,
            ckpt_dir=ckpt_dir,
            resume=resume,
        )
        self.recorder = U.EventRecorder(ckpt_dir=ckpt_dir, resume=resume)
        self.resume = resume
        self.reset_mode = reset_mode
        self.game_mode = os.environ.get("GAME_MODE", "creative")

        # init variables for rollout
        self.action_agent_rollout_num_iter = -1
        self.task = None
        self.context = ""
        self.messages = None
        self.conversations = []
        self.last_events = None

    def reset(self, task, context="", reset_env=True):
        self.action_agent_rollout_num_iter = 0
        self.task = task
        self.context = context
        if reset_env:
            self.env.reset(
                options={
                    "mode": "soft",
                    "wait_ticks": self.env_wait_ticks,
                    "game_mode": self.game_mode,
                }
            )
        difficulty = (
            "easy" if len(self.curriculum_agent.completed_tasks) > 15 else "peaceful"
        )
        # step to peek an observation
        if self.game_mode == "creative":
            events = self.env.step(
                "bot.chat(`/time set ${getNextTime()}`);\n"
                + f"bot.chat('/difficulty {difficulty}');"
            )
        else:
            events = self.env.step("")
        skills = self.skill_manager.retrieve_skills(query=self.context)
        print(
            f"\033[33mRender Action Agent system message with {len(skills)} skills\033[0m"
        )
        system_message = self.action_agent.render_system_message(skills=skills)
        human_message = self.action_agent.render_human_message(
            events=events, code="", task=self.task, context=context, critique=""
        )
        self.messages = [system_message, human_message]
        print(
            f"\033[32m****Action Agent human message****\n{human_message.content}\033[0m"
        )
        assert len(self.messages) == 2
        self.conversations = []
        return self.messages

    def close(self):
        self.env.close()

    def step(self):
        if self.action_agent_rollout_num_iter < 0:
            raise ValueError("Agent must be reset before stepping")
        ai_message = self.action_agent.llm.invoke(self.messages)
        print(f"\033[34m****Action Agent ai message****\n{ai_message.content}\033[0m")
        self.conversations.append(
            (self.messages[0].content, self.messages[1].content, ai_message.content)
        )
        parsed_result = self.action_agent.process_ai_message(message=ai_message)
        success = False
        if isinstance(parsed_result, dict):
            code = parsed_result["program_code"] + "\n" + parsed_result["exec_code"]
            events = self.env.step(
                code,
                programs=self.skill_manager.programs,
            )
            self.recorder.record(events, self.task)
            self._process_survival_events(events)
            self.action_agent.update_chest_memory(events[-1][1]["nearbyChests"])
            success, critique = self.critic_agent.check_task_success(
                events=events,
                task=self.task,
                context=self.context,
                chest_observation=self.action_agent.render_chest_observation(),
                max_retries=5,
            )

            if self.reset_placed_if_failed and not success:
                # revert all the placing event in the last step
                blocks = []
                positions = []
                for event_type, event in events:
                    if event_type == "onSave" and event["onSave"].endswith("_placed"):
                        block = event["onSave"].split("_placed")[0]
                        position = event["status"]["position"]
                        blocks.append(block)
                        positions.append(position)
                new_events = self.env.step(
                    f"await givePlacedItemBack(bot, {U.json_dumps(blocks)}, {U.json_dumps(positions)})",
                    programs=self.skill_manager.programs,
                )
                events[-1][1]["inventory"] = new_events[-1][1]["inventory"]
                events[-1][1]["voxels"] = new_events[-1][1]["voxels"]
            new_skills = self.skill_manager.retrieve_skills(
                query=self.context
                + "\n\n"
                + self.action_agent.summarize_chatlog(events)
            )
            system_message = self.action_agent.render_system_message(skills=new_skills)
            human_message = self.action_agent.render_human_message(
                events=events,
                code=parsed_result["program_code"],
                task=self.task,
                context=self.context,
                critique=critique,
            )
            self.last_events = copy.deepcopy(events)
            self.messages = [system_message, human_message]
        else:
            assert isinstance(parsed_result, str)
            self.recorder.record([], self.task)
            print(f"\033[34m{parsed_result} Trying again!\033[0m")
        assert len(self.messages) == 2
        self.action_agent_rollout_num_iter += 1
        done = (
            self.action_agent_rollout_num_iter >= self.action_agent_task_max_retries
            or success
        )
        info = {
            "task": self.task,
            "success": success,
            "conversations": self.conversations,
        }
        if success:
            assert (
                "program_code" in parsed_result and "program_name" in parsed_result
            ), "program and program_name must be returned when success"
            info["program_code"] = parsed_result["program_code"]
            info["program_name"] = parsed_result["program_name"]
        else:
            print(
                f"\033[32m****Action Agent human message****\n{self.messages[-1].content}\033[0m"
            )
        return self.messages, 0, done, info

    def rollout(self, *, task, context, reset_env=True):
        self.reset(task=task, context=context, reset_env=reset_env)
        while True:
            messages, reward, done, info = self.step()
            if done:
                break
        return messages, reward, done, info

    def _process_survival_events(self, events):
        if self.game_mode != "survival":
            return
        last_obs = events[-1][1]
        status = last_obs.get("status", {})
        reactive = last_obs.get("recentReactiveEvents", [])

        for e in reactive:
            if e.get("trigger") == "bot_death":
                context = (
                    f"timeOfDay={status.get('timeOfDay', 'unknown')}, "
                    f"biome={status.get('biome', 'unknown')}, "
                    f"isSheltered={status.get('isSheltered', False)}"
                )
                self.survival_memory.record_event(
                    "death", e.get("inferred_cause", "unknown"), context
                )

        damage_events = [e for e in reactive if e.get("trigger") == "significant_damage"]
        if damage_events:
            worst = max(damage_events, key=lambda e: e.get("damage_amount", 0))
            context = (
                f"damage={worst['damage_amount']:.1f}hp, "
                f"health_after={worst['health_after']:.1f}/20, "
                f"biome={status.get('biome', 'unknown')}, "
                f"timeOfDay={status.get('timeOfDay', 'unknown')}"
            )
            self.survival_memory.record_event(
                "significant_damage", worst.get("damage_source", "unknown"), context
            )

        for event_type, event in events:
            if event_type == "onSave" and event.get("onSave") == "shelter_built":
                context = (
                    f"isSheltered=True, "
                    f"biome={status.get('biome', 'unknown')}, "
                    f"timeOfDay={status.get('timeOfDay', 'unknown')}"
                )
                self.survival_memory.record_event("shelter_built", "player_skill", context)

    def _get_shelter_task(self, last_obs):
        inventory = last_obs.get("inventory", {})

        _SHELTER_BLOCKS = ("cobblestone", "dirt", "stone", "oak_planks", "spruce_planks",
                           "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks")
        has_blocks = any(b in inventory for b in _SHELTER_BLOCKS)
        has_torch = "torch" in inventory

        if not has_blocks:
            return (
                "Mine 16 cobblestone or dirt for shelter materials",
                "It is night and you have no shelter. Collect building blocks first — cobblestone or dirt.",
            )
        if not has_torch:
            return (
                "Craft 4 torches for shelter lighting",
                "It is night and you have no shelter. Craft torches (coal + stick) to light the shelter interior.",
            )
        return (
            "Build a shelter around yourself and stand inside it",
            "It is night and you are not sheltered. Build a small enclosed space AROUND your current position: "
            "place solid blocks on 3 sides of you, place a roof block directly above your head (at Y+2), "
            "then place a torch on one of the interior walls. "
            "After placing all blocks, walk to the center of the shelter and stay there. "
            "Use bot.entity.position to place blocks relative to your location. "
            "Do not walk away from the shelter after building it.",
        )

    def _get_food_task(self, last_obs):
        inventory = last_obs.get("inventory", {})
        voxels = last_obs.get("voxels", [])
        entities = last_obs["status"].get("entities", {})

        raw_in_inv = [(m, inventory[m]) for m in _RAW_MEATS if m in inventory]
        if raw_in_inv and "furnace" in voxels:
            meat, count = max(raw_in_inv, key=lambda x: x[1])
            return (
                f"Smelt {count} {meat}",
                f"You have {count} {meat} and a furnace is nearby. Smelt it for food.",
            )

        has_weapon = any(w in inventory for w in _WEAPON_NAMES)
        nearby_animals = sorted(
            [a for a in _ANIMAL_MOBS if a in entities],
            key=lambda a: entities[a],
        )
        if has_weapon and nearby_animals:
            target = nearby_animals[0]
            return (
                f"Kill 1 {target} for food",
                f"You have a weapon and a {target} is nearby. Kill it for food.",
            )

        wheat_count = inventory.get("wheat", 0)
        if wheat_count >= 3:
            bread_count = wheat_count // 3
            return (
                f"Craft {bread_count} bread",
                f"You have {wheat_count} wheat. Craft bread (3 wheat = 1 bread) for food.",
            )

        return (
            "Explore to find food — look for animals or crops",
            "No immediate food source available. Explore to find animals, crops, or naturally generated food.",
        )

    def _propose_next_task(self, game_mode):
        if game_mode == "survival":
            last_obs = self.last_events[-1][1]
            health = last_obs["status"]["health"]
            food = last_obs["status"]["food"]
            is_on_fire = last_obs["status"].get("isOnFire", False)
            if is_on_fire:
                return (
                    "Find water to extinguish the fire",
                    "The bot is on fire. Finding water is the immediate priority.",
                )
            if health < 6:
                return (
                    "Eat food or find safety to restore health",
                    "Health is critically low (below 3 hearts). Survival is the only priority.",
                )
            recent_events = last_obs.get("recentReactiveEvents", [])
            food_emergency = (
                any(e.get("trigger") == "noFood" for e in recent_events)
                or food < 6
            )
            if food_emergency:
                return self._get_food_task(last_obs)
            is_sheltered = last_obs["status"].get("isSheltered", False)
            time_of_day = last_obs["status"].get("timeOfDay", "day")
            # Afternoon/dusk: proactively propose shelter while it is still light
            # At night, pillarUp (reactive layer) is the fallback — don't interrupt with construction tasks
            if not is_sheltered and time_of_day in ("noon", "sunset"):
                last_task = self.task or ""
                if not any(
                    kw in last_task.lower()
                    for kw in ("shelter", "torch", "cobblestone or dirt")
                ):
                    return self._get_shelter_task(last_obs)
        survival_lessons = (
            self.survival_memory.get_recent_lessons()
            if self.game_mode == "survival"
            else ""
        )
        return self.curriculum_agent.propose_next_task(
            events=self.last_events,
            chest_observation=self.action_agent.render_chest_observation(),
            max_retries=5,
            survival_lessons=survival_lessons,
        )

    def learn(self, reset_env=True):
        if self.resume:
            self.env.reset(
                options={
                    "mode": "soft",
                    "wait_ticks": self.env_wait_ticks,
                    "game_mode": self.game_mode,
                }
            )
        else:
            self.env.reset(
                options={
                    "mode": self.reset_mode,
                    "wait_ticks": self.env_wait_ticks,
                    "game_mode": self.game_mode,
                }
            )
            self.resume = True
        self.last_events = self.env.step("")

        game_mode = os.environ.get("GAME_MODE", "creative")

        while True:
            if self.recorder.iteration > self.max_iterations:
                print("Iteration limit reached")
                break
            task, context = self._propose_next_task(game_mode)
            print(
                f"\033[35mStarting task {task} for at most {self.action_agent_task_max_retries} times\033[0m"
            )
            try:
                messages, reward, done, info = self.rollout(
                    task=task,
                    context=context,
                    reset_env=reset_env,
                )
            except Exception as e:
                time.sleep(3)  # wait for mineflayer to exit
                info = {
                    "task": task,
                    "success": False,
                }
                # reset bot status here
                if self.reset_mode == "hard":
                    self.last_events = self.env.reset(
                        options={
                            "mode": "hard",
                            "wait_ticks": self.env_wait_ticks,
                            "game_mode": self.game_mode,
                            "inventory": self.last_events[-1][1]["inventory"],
                            "equipment": self.last_events[-1][1]["status"]["equipment"],
                            "position": self.last_events[-1][1]["status"]["position"],
                        }
                    )
                else:
                    self.last_events = self.env.reset(
                        options={
                            "mode": "soft",
                            "wait_ticks": self.env_wait_ticks,
                            "game_mode": self.game_mode,
                        }
                    )
                # use red color background to print the error
                print("Your last round rollout terminated due to error:")
                print(f"\033[41m{e}\033[0m")

            if info["success"]:
                self.skill_manager.add_new_skill(info)

            self.curriculum_agent.update_exploration_progress(info)
            print(
                f"\033[35mCompleted tasks: {', '.join(self.curriculum_agent.completed_tasks)}\033[0m"
            )
            print(
                f"\033[35mFailed tasks: {', '.join(self.curriculum_agent.failed_tasks)}\033[0m"
            )

        return {
            "completed_tasks": self.curriculum_agent.completed_tasks,
            "failed_tasks": self.curriculum_agent.failed_tasks,
            "skills": self.skill_manager.skills,
        }

    def decompose_task(self, task):
        if not self.last_events:
            self.last_events = self.env.reset(
                options={
                    "mode": "hard",
                    "wait_ticks": self.env_wait_ticks,
                    "game_mode": self.game_mode,
                }
            )
        return self.curriculum_agent.decompose_task(task, self.last_events)

    def inference(self, task=None, sub_goals=[], reset_mode="hard", reset_env=True):
        if not task and not sub_goals:
            raise ValueError("Either task or sub_goals must be provided")
        if not sub_goals:
            sub_goals = self.decompose_task(task)
        self.env.reset(
            options={
                "mode": reset_mode,
                "wait_ticks": self.env_wait_ticks,
                "game_mode": self.game_mode,
            }
        )
        self.curriculum_agent.completed_tasks = []
        self.curriculum_agent.failed_tasks = []
        self.last_events = self.env.step("")
        while self.curriculum_agent.progress < len(sub_goals):
            next_task = sub_goals[self.curriculum_agent.progress]
            context = self.curriculum_agent.get_task_context(next_task)
            print(
                f"\033[35mStarting task {next_task} for at most {self.action_agent_task_max_retries} times\033[0m"
            )
            messages, reward, done, info = self.rollout(
                task=next_task,
                context=context,
                reset_env=reset_env,
            )
            self.curriculum_agent.update_exploration_progress(info)
            print(
                f"\033[35mCompleted tasks: {', '.join(self.curriculum_agent.completed_tasks)}\033[0m"
            )
            print(
                f"\033[35mFailed tasks: {', '.join(self.curriculum_agent.failed_tasks)}\033[0m"
            )
