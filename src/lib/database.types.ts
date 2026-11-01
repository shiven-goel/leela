// Generated from the live Supabase schema (project rtebcagicaypvgfeqsjn). Regenerate after schema changes.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18'
  }
  public: {
    Tables: {
      children: {
        Row: {
          avatar_path: string | null
          birth_date: string | null
          created_at: string
          deleted_at: string | null
          due_date: string | null
          family_id: string
          id: string
          name: string
          settings: Json
          sex: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          birth_date?: string | null
          created_at?: string
          deleted_at?: string | null
          due_date?: string | null
          family_id: string
          id?: string
          name: string
          settings?: Json
          sex?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          birth_date?: string | null
          created_at?: string
          deleted_at?: string | null
          due_date?: string | null
          family_id?: string
          id?: string
          name?: string
          settings?: Json
          sex?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          app_url: string | null
          auth: string
          created_at: string
          disabled_at: string | null
          disabled_reason: string | null
          endpoint: string
          family_id: string
          id: string
          last_sent_at: string | null
          lead_min: number
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          app_url?: string | null
          auth: string
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          endpoint: string
          family_id: string
          id?: string
          last_sent_at?: string | null
          lead_min?: number
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Update: {
          app_url?: string | null
          auth?: string
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          endpoint?: string
          family_id?: string
          id?: string
          last_sent_at?: string | null
          lead_min?: number
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          child_id: string | null
          created_at: string
          created_by: string | null
          data: Json
          deleted_at: string | null
          ended_at: string | null
          family_id: string
          id: string
          import_id: string | null
          notes: string | null
          photo_paths: string[]
          source: string
          started_at: string
          timer_state: string | null
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          child_id?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          deleted_at?: string | null
          ended_at?: string | null
          family_id: string
          id: string
          import_id?: string | null
          notes?: string | null
          photo_paths?: string[]
          source?: string
          started_at: string
          timer_state?: string | null
          type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          child_id?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          deleted_at?: string | null
          ended_at?: string | null
          family_id?: string
          id?: string
          import_id?: string | null
          notes?: string | null
          photo_paths?: string[]
          source?: string
          started_at?: string
          timer_state?: string | null
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      families: {
        Row: {
          code: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          night_end: string
          night_start: string
          owner_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          night_end?: string
          night_start?: string
          owner_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          name?: string
          night_end?: string
          night_start?: string
          timezone?: string
        }
        Relationships: []
      }
      family_members: {
        Row: {
          family_id: string
          joined_at: string
          last_seen_at: string
          removed_at: string | null
          user_id: string
        }
        Insert: never
        Update: {
          last_seen_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: number
          at: string
          family_id: string | null
          actor: string | null
          table_name: string
          row_id: string
          action: string
          changes: Json
        }
        Insert: never
        Update: never
        Relationships: []
      }
      imports: {
        Row: {
          counts: Json
          created_at: string
          created_by: string | null
          family_id: string
          file_name: string | null
          id: string
          reader: string
          status: string
          undone_at: string | null
        }
        Insert: {
          counts?: Json
          created_at?: string
          created_by?: string | null
          family_id: string
          file_name?: string | null
          id?: string
          reader?: string
          status?: string
          undone_at?: string | null
        }
        Update: {
          counts?: Json
          created_at?: string
          created_by?: string | null
          family_id?: string
          file_name?: string | null
          id?: string
          reader?: string
          status?: string
          undone_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          display_name: string
          id: string
          prefs: Json
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string
          id: string
          prefs?: Json
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string
          id?: string
          prefs?: Json
          updated_at?: string
        }
        Relationships: []
      }
      timer_segments: {
        Row: {
          created_at: string
          ended_at: string | null
          event_id: string
          family_id: string
          id: string
          side: string | null
          started_at: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          event_id: string
          family_id: string
          id: string
          side?: string | null
          started_at: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          event_id?: string
          family_id?: string
          id?: string
          side?: string | null
          started_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      create_family: { Args: { p_display_name: string; p_family_name: string; p_timezone?: string }; Returns: Json }
      join_family: { Args: { p_code: string; p_confirm?: boolean; p_display_name?: string }; Returns: Json }
      leave_family: { Args: { p_confirm?: string | null }; Returns: Json }
      nursing_set: { Args: { p_at: string; p_event_id: string; p_segment_id?: string; p_side: string | null }; Returns: undefined }
      remove_member: { Args: { p_user_id: string }; Returns: Json }
      reset_family_code: { Args: never; Returns: Json }
      timer_stop: { Args: { p_at: string; p_event_id: string }; Returns: undefined }
      transfer_ownership: { Args: { p_user_id: string }; Returns: Json }
      undo_import: { Args: { p_import_id: string }; Returns: Json }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type TableName = keyof Database['public']['Tables']
export type RpcName = keyof Database['public']['Functions']
