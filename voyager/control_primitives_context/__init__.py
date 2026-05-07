import pathlib
import voyager.utils as U

_PRIMITIVES_CONTEXT_PATH = pathlib.Path(__file__).parent


def load_control_primitives_context(primitive_names=None):
    if primitive_names is None:
        primitive_names = [
            p.stem for p in _PRIMITIVES_CONTEXT_PATH.iterdir() if p.suffix == ".js"
        ]
    return [
        U.load_text(str(_PRIMITIVES_CONTEXT_PATH / f"{name}.js"))
        for name in primitive_names
    ]
