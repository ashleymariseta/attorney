"""Matter-room websocket: clients subscribe by channel ID, receive chat events
fanned out by the REST API (message.created, message.reaction, …)."""

import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .models import Channel


class ChannelConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.channel_id = self.scope['url_route']['kwargs']['channel_id']
        user = self.scope.get('user')
        if not user or not getattr(user, 'is_authenticated', False):
            await self.close(code=4401)
            return
        if not await self._is_member(self.channel_id, user.id):
            await self.close(code=4403)
            return
        self.group_name = f'channel_{self.channel_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        # Clients don't push directly; the REST API broadcasts. We accept pings.
        if not text_data:
            return
        try:
            payload = json.loads(text_data)
        except ValueError:
            return
        if payload.get('type') == 'ping':
            await self.send(text_data=json.dumps({'type': 'pong'}))

    async def channel_event(self, event):
        await self.send(text_data=json.dumps(event['payload']))

    @database_sync_to_async
    def _is_member(self, channel_id, user_id):
        return Channel.objects.filter(pk=channel_id, members__id=user_id).exists()
