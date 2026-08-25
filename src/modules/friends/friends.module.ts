import { Module, forwardRef } from '@nestjs/common';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { SupabaseModule } from '../../infra/supabase/supabase.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [SupabaseModule, forwardRef(() => EventsModule)],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
