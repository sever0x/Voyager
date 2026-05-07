import os
from dotenv import load_dotenv
from voyager import Voyager

load_dotenv()

mc_port = int(os.environ["MC_PORT"])
openai_api_key = os.environ["OPENAI_API_KEY"]

voyager = Voyager(
    mc_port=mc_port,
    openai_api_key=openai_api_key,
    action_agent_model_name=os.environ.get("ACTION_MODEL", "gpt-5.4-mini"),
    curriculum_agent_model_name=os.environ.get("CURRICULUM_MODEL", "gpt-5.4-mini"),
    curriculum_agent_qa_model_name=os.environ.get("CURRICULUM_QA_MODEL", "gpt-5.4-nano"),
    critic_agent_model_name=os.environ.get("CRITIC_MODEL", "gpt-5.4-mini"),
    skill_manager_model_name=os.environ.get("SKILL_MODEL", "gpt-5.4-nano"),
    embedding_model_name=os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small"),
    action_agent_include_advanced_primitives=os.environ.get("ACTION_ADVANCED_PRIMITIVES", "true").lower() == "true",
)
voyager.learn()
