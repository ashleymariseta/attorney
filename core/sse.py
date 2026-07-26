"""Server-Sent Events transport for matter-room realtime.

The realtime feed is push-only — the REST API creates messages / documents /
payments and broadcasts the result; clients only consume. SSE is plain HTTP
(a long-lived ``GET`` with ``text/event-stream``), so it sails through the
proxies, load balancers and CDNs that choke on WebSocket upgrades.

Fan-out uses Redis pub/sub: ``publish_channel_event`` (called from the REST
broadcast helper) publishes to ``sse:channel:{id}``; each connected client
subscribes to its channel's feed via an async streaming view.
"""
import json

from asgiref.sync import sync_to_async
from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import HttpResponse, HttpResponseNotAllowed, StreamingHttpResponse

_SSE_PREFIX = 'sse:channel:'
# Seconds between heartbeat comments — keeps proxies from idling the stream out.
HEARTBEAT_SECONDS = 20


def _redis_url() -> str:
    return getattr(settings, 'REDIS_URL', None) or 'redis://127.0.0.1:6379/0'


def publish_channel_event(channel_id, payload) -> None:
    """Publish a chat event to a channel's SSE feed. Sync, safe to call from a
    request handler, and never raises (realtime must not break the request)."""
    try:
        import redis

        client = redis.from_url(_redis_url())
        try:
            client.publish(f'{_SSE_PREFIX}{channel_id}', json.dumps(payload))
        finally:
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass
    except Exception:  # noqa: BLE001
        pass


@sync_to_async
def _authenticate(token):
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken

    if not token:
        return None
    try:
        access = AccessToken(token)
    except TokenError:
        return None
    user_id = access.get('user_id')
    if user_id is None:
        return None
    User = get_user_model()
    try:
        return User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return None


@sync_to_async
def _is_member(channel_id, user_id) -> bool:
    from .models import Channel

    return Channel.objects.filter(id=channel_id, members__id=user_id).exists()


async def _event_stream(channel_id):
    """Async generator yielding SSE frames from the channel's Redis feed."""
    import redis.asyncio as aioredis

    client = aioredis.from_url(_redis_url())
    pubsub = client.pubsub()
    await pubsub.subscribe(f'{_SSE_PREFIX}{channel_id}')
    # Open the stream immediately so the client flips to "connected".
    yield b': connected\n\n'
    try:
        while True:
            try:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=HEARTBEAT_SECONDS
                )
            except Exception:  # noqa: BLE001 — Redis hiccup: end the stream, client reconnects
                break
            if message is None:
                yield b': ping\n\n'  # heartbeat comment
                continue
            data = message.get('data')
            if data is None:
                continue
            if isinstance(data, bytes):
                data = data.decode('utf-8', 'ignore')
            # `data` is already a JSON string from publish_channel_event.
            yield f'data: {data}\n\n'.encode('utf-8')
    finally:
        try:
            await pubsub.unsubscribe(f'{_SSE_PREFIX}{channel_id}')
            await pubsub.aclose()
            await client.aclose()
        except Exception:  # noqa: BLE001
            pass


async def channel_events(request, channel_id):
    """SSE endpoint: ``GET /api/v1/channels/{id}/events/?token=<access>``.

    Authenticates the JWT from the query string (EventSource can't send an
    Authorization header) and checks channel membership, then streams events.
    """
    if request.method != 'GET':
        return HttpResponseNotAllowed(['GET'])

    user = await _authenticate(request.GET.get('token', ''))
    if user is None:
        return HttpResponse('Unauthorized', status=401)
    if not await _is_member(channel_id, user.id):
        return HttpResponse('Forbidden', status=403)

    response = StreamingHttpResponse(
        _event_stream(channel_id), content_type='text/event-stream'
    )
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'  # tell nginx not to buffer the stream
    response['Connection'] = 'keep-alive'
    return response
