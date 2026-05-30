import json
from channels.generic.websocket import AsyncWebsocketConsumer


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.matter_id = self.scope['url_route']['kwargs']['matter_id']
        self.group_name = f'matter_{self.matter_id}'

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if text_data is None:
            return
        payload = json.loads(text_data)
        await self.channel_layer.group_send(
            self.group_name,
            {
                'type': 'chat.message',
                'message': payload.get('message'),
                'sender': self.scope['user'].email if self.scope['user'].is_authenticated else 'anonymous',
            },
        )

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({'message': event['message'], 'sender': event['sender']}))
