import os
import time
from datetime import datetime, timezone

import voyager.utils as U
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

_LESSON_SYSTEM = (
    "You are a Minecraft survival advisor. Given a survival event, generate a single "
    "actionable lesson in one sentence (max 20 words). "
    "Start with an imperative verb or noun phrase. Do not start with 'I' or 'You'."
)


class SurvivalMemory:
    def __init__(self, llm: BaseChatModel, ckpt_dir: str = "ckpt", resume: bool = False):
        self.llm = llm
        self.ckpt_dir = ckpt_dir
        U.f_mkdir(f"{ckpt_dir}/survival")
        path = f"{ckpt_dir}/survival/experiences.json"
        self.experiences = U.load_json(path) if resume and os.path.exists(path) else []

    def record_event(self, event_type: str, cause: str, context: str) -> None:
        if self.experiences:
            last = self.experiences[-1]
            if last["type"] == event_type and last["cause"] == cause:
                return
        lesson = self._generate_lesson(event_type, cause, context)
        self.experiences.append({
            "id": f"exp_{len(self.experiences) + 1:04d}",
            "type": event_type,
            "cause": cause,
            "context": context,
            "lesson": lesson,
            "timestamp": int(time.time() * 1000),
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        })
        U.dump_json(self.experiences, f"{self.ckpt_dir}/survival/experiences.json")

    def get_recent_lessons(self, n: int = 5) -> str:
        if not self.experiences:
            return ""
        return "\n".join(
            f"- {e['lesson']}"
            for e in self.experiences[-n:][::-1]
        )

    def _generate_lesson(self, event_type: str, cause: str, context: str) -> str:
        human = (
            f"Event type: {event_type}\n"
            f"Cause: {cause}\n"
            f"Context: {context}\n"
            f"Lesson:"
        )
        return self.llm.invoke([
            SystemMessage(content=_LESSON_SYSTEM),
            HumanMessage(content=human),
        ]).content.strip()
