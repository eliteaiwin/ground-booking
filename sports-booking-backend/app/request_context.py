from contextvars import ContextVar

# Role the user is currently acting as in the app (sent by the frontend as X-Active-Role).
active_role: ContextVar[str] = ContextVar("active_role", default="")
# Real person behind an impersonation token (0 when the user is acting as themselves).
impersonator_id: ContextVar[int] = ContextVar("impersonator_id", default=0)
