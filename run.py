import os
from dotenv import load_dotenv
from voyager import Voyager

load_dotenv()

mc_port = int(os.environ["MC_PORT"])
openai_api_key = os.environ["OPENAI_API_KEY"]

voyager = Voyager(
    mc_port=mc_port,
    openai_api_key=openai_api_key,
)
voyager.learn()
