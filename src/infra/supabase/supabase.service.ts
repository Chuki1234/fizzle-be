import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { Env } from '../../config/env.validation';

/**
 * Two clients, deliberately kept apart:
 *
 * - `admin` carries the service-role key. It bypasses RLS, so it is used only
 *   for server-owned writes (creating a profile row, looking up a user by id).
 * - `anon` carries the public key and is used for the user-credential flows
 *   (`signInWithPassword`, `refreshSession`, `verifyOtp`) where Supabase must
 *   act *as the user*, not as an administrator.
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private _admin!: SupabaseClient;
  private _anon!: SupabaseClient;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const url = this.config.get('SUPABASE_URL', { infer: true });

    this._admin = createClient(
      url,
      this.config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    this._anon = createClient(
      url,
      this.config.get('SUPABASE_ANON_KEY', { infer: true }),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  get admin(): SupabaseClient {
    return this._admin;
  }

  get anon(): SupabaseClient {
    return this._anon;
  }
}
