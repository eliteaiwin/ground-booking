from contextvars import ContextVar

# Role the user is currently acting as in the app (sent by the frontend as X-Active-Role).
active_role: ContextVar[str] = ContextVar("active_role", default="")
