import pathlib
import voyager.utils as U

_PACKAGE_PATH = pathlib.Path(__file__).parent.parent


def load_prompt(prompt):
    return U.load_text(str(_PACKAGE_PATH / "prompts" / f"{prompt}.txt"))
