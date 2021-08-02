import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SocketAdapter } from './socket.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
  });
  app.useWebSocketAdapter(new SocketAdapter(app));
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
