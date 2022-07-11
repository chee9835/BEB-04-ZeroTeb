import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventModule } from './event/event.module';
import { TokenModule } from './token/token.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    MongooseModule.forRoot(
      `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.u22wt11.mongodb.net/?retryWrites=true&w=majority`,
    ),
    EventModule,
    TokenModule,
    AuthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
