import os

from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel


def create_llm(provider: str, model: str, **kwargs) -> BaseChatModel:
    if provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model, **kwargs)
    elif provider == "openrouter":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=os.environ["OPENROUTER_API_KEY"],
            **kwargs,
        )
    elif provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        # ChatAnthropic uses 'timeout' (float), not 'request_timeout'
        anthropic_kwargs = {k: v for k, v in kwargs.items() if k != "request_timeout"}
        if "request_timeout" in kwargs:
            anthropic_kwargs["timeout"] = float(kwargs["request_timeout"])
        return ChatAnthropic(model=model, **anthropic_kwargs)
    else:
        raise ValueError(
            f"Unknown LLM provider: {provider!r}. Supported: openai, openrouter, anthropic"
        )


def create_embeddings(provider: str, model: str, **kwargs) -> Embeddings:
    if provider == "openai":
        from langchain_openai import OpenAIEmbeddings
        return OpenAIEmbeddings(model=model, **kwargs)
    else:
        raise ValueError(
            f"Unknown embeddings provider: {provider!r}. Supported: openai"
        )
