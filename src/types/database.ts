/**
 * ATENÇÃO — gerado MANUALMENTE a partir de supabase/migrations/ (001–003).
 *
 * O ambiente em que as migrations foram escritas não tem Docker, então
 * `supabase gen types` não pôde rodar. Este arquivo reproduz o formato do
 * `supabase gen types typescript` (tabelas, views, functions, enums). Quando houver
 * Docker, REGENERE com `npm run db:types` (requer `supabase start`) e commite o
 * resultado. Atualize-o também sempre que uma migration mudar o schema.
 *
 * Funções que retornam `trigger` não aparecem (não são RPC). Colunas de views são
 * sempre anuláveis, como no gerador oficial.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      course_modules: {
        Row: {
          course_id: string
          created_at: string
          id: string
          position: number
          title: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          position: number
          title: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          position?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          category_id: string | null
          cover_path: string | null
          created_at: string
          created_by: string | null
          description: string
          estimated_minutes: number | null
          id: string
          level: Database["public"]["Enums"]["course_level"]
          price_cents: number
          published_at: string | null
          slug: string
          status: Database["public"]["Enums"]["course_status"]
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          estimated_minutes?: number | null
          id?: string
          level?: Database["public"]["Enums"]["course_level"]
          price_cents?: number
          published_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["course_status"]
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          estimated_minutes?: number | null
          id?: string
          level?: Database["public"]["Enums"]["course_level"]
          price_cents?: number
          published_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["course_status"]
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          course_id: string
          created_at: string
          granted_at: string
          granted_by: string | null
          id: string
          order_id: string | null
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          source: Database["public"]["Enums"]["enrollment_source"]
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          order_id?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source: Database["public"]["Enums"]["enrollment_source"]
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          order_id?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source?: Database["public"]["Enums"]["enrollment_source"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_order_fkey"
            columns: ["order_id", "user_id", "course_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "user_id", "course_id"]
          },
        ]
      }
      lesson_materials: {
        Row: {
          body: string | null
          course_id: string
          created_at: string
          external_url: string | null
          file_name: string | null
          file_size: number | null
          id: string
          lesson_id: string
          mime_type: string | null
          position: number
          show_in_all_lessons: boolean
          storage_path: string | null
          title: string | null
          type: Database["public"]["Enums"]["material_type"]
          updated_at: string
          video_id: string | null
          video_provider: string | null
        }
        Insert: {
          body?: string | null
          course_id: string
          created_at?: string
          external_url?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          lesson_id: string
          mime_type?: string | null
          position: number
          show_in_all_lessons?: boolean
          storage_path?: string | null
          title?: string | null
          type: Database["public"]["Enums"]["material_type"]
          updated_at?: string
          video_id?: string | null
          video_provider?: string | null
        }
        Update: {
          body?: string | null
          course_id?: string
          created_at?: string
          external_url?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          lesson_id?: string
          mime_type?: string | null
          position?: number
          show_in_all_lessons?: boolean
          storage_path?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["material_type"]
          updated_at?: string
          video_id?: string | null
          video_provider?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_materials_lesson_fkey"
            columns: ["lesson_id", "course_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id", "course_id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          completed_at: string | null
          course_id: string
          created_at: string
          last_position_seconds: number
          lesson_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          course_id: string
          created_at?: string
          last_position_seconds?: number
          lesson_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          completed_at?: string | null
          course_id?: string
          created_at?: string
          last_position_seconds?: number
          lesson_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_lesson_fkey"
            columns: ["lesson_id", "course_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id", "course_id"]
          },
        ]
      }
      lessons: {
        Row: {
          course_id: string
          created_at: string
          duration_seconds: number | null
          id: string
          is_preview: boolean
          module_id: string
          position: number
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_preview?: boolean
          module_id: string
          position: number
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_preview?: boolean
          module_id?: string
          position?: number
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_module_fkey"
            columns: ["module_id", "course_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id", "course_id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_cents: number
          course_id: string
          created_at: string
          created_by: string | null
          currency: string
          expires_at: string | null
          id: string
          paid_at: string | null
          pix_br_code: string | null
          pix_br_code_base64: string | null
          provider: string
          provider_billing_id: string | null
          refund_requested_at: string | null
          refund_requested_progress: number | null
          refunded_at: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          course_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          expires_at?: string | null
          id?: string
          paid_at?: string | null
          pix_br_code?: string | null
          pix_br_code_base64?: string | null
          provider?: string
          provider_billing_id?: string | null
          refund_requested_at?: string | null
          refund_requested_progress?: number | null
          refunded_at?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          course_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          expires_at?: string | null
          id?: string
          paid_at?: string | null
          pix_br_code?: string | null
          pix_br_code_base64?: string | null
          provider?: string
          provider_billing_id?: string | null
          refund_requested_at?: string | null
          refund_requested_progress?: number | null
          refunded_at?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          event_type: string
          id: string
          order_id: string | null
          payload: Json
          processed_at: string | null
          processing_error: string | null
          provider: string
          provider_event_id: string
          received_at: string
        }
        Insert: {
          event_type: string
          id?: string
          order_id?: string | null
          payload: Json
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_event_id: string
          received_at?: string
        }
        Update: {
          event_type?: string
          id?: string
          order_id?: string | null
          payload?: Json
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_event_id?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          full_name: string
          id: string
          phone: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          id: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      course_catalog: {
        Row: {
          category_id: string | null
          category_name: string | null
          category_position: number | null
          category_slug: string | null
          cover_path: string | null
          description: string | null
          estimated_minutes: number | null
          id: string | null
          lesson_count: number | null
          level: Database["public"]["Enums"]["course_level"] | null
          module_count: number | null
          price_cents: number | null
          published_at: string | null
          slug: string | null
          subtitle: string | null
          title: string | null
          total_duration_seconds: number | null
        }
        Relationships: [
          {
            foreignKeyName: "courses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      course_outline: {
        Row: {
          course_id: string | null
          duration_seconds: number | null
          is_preview: boolean | null
          lesson_id: string | null
          lesson_position: number | null
          lesson_summary: string | null
          lesson_title: string | null
          module_id: string | null
          module_position: number | null
          module_title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_module_fkey"
            columns: ["module_id", "course_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id", "course_id"]
          },
        ]
      }
      my_library: {
        Row: {
          completed_count: number | null
          course_id: string | null
          course_status: Database["public"]["Enums"]["course_status"] | null
          cover_path: string | null
          first_granted_at: string | null
          has_admin_grant: boolean | null
          has_purchase: boolean | null
          is_completed: boolean | null
          last_accessed_at: string | null
          last_lesson_id: string | null
          lesson_count: number | null
          level: Database["public"]["Enums"]["course_level"] | null
          progress_percent: number | null
          slug: string | null
          sources: Database["public"]["Enums"]["enrollment_source"][] | null
          subtitle: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_dashboard_metrics: {
        Args: {
          p_from: string
          p_to: string
        }
        Returns: {
          avg_ticket_cents: number
          enrollments_admin_grant: number
          enrollments_purchase: number
          pending_refund_requests: number
          refunds_count: number
          revenue_cents: number
          sales_count: number
          students_new: number
          students_total: number
        }[]
      }
      admin_record_manual_sale: {
        Args: {
          p_amount_cents?: number
          p_course_id: string
          p_user_id: string
        }
        Returns: string
      }
      admin_revenue_by_day: {
        Args: {
          p_from: string
          p_to: string
        }
        Returns: {
          day: string
          revenue_cents: number
          sales: number
        }[]
      }
      admin_course_students: {
        Args: {
          p_course_id: string
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: {
          completed_count: number
          email: string
          enrollment_id: string
          full_name: string
          granted_at: string
          lesson_count: number
          revoked_at: string | null
          source: Database["public"]["Enums"]["enrollment_source"]
          total_count: number
          user_id: string
        }[]
      }
      admin_student_by_id: {
        Args: { p_user_id: string }
        Returns: {
          active_enrollments: number
          created_at: string
          email: string
          full_name: string
          is_admin: boolean
          last_order_at: string
          total_spent_cents: number
          user_id: string
        }[]
      }
      admin_students: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: {
          active_enrollments: number
          created_at: string
          email: string
          full_name: string
          is_admin: boolean
          last_order_at: string
          total_count: number
          total_spent_cents: number
          user_id: string
        }[]
      }
      admin_top_courses: {
        Args: {
          p_from: string
          p_limit?: number
          p_to: string
        }
        Returns: {
          course_id: string
          revenue_cents: number
          sales: number
          slug: string
          title: string
        }[]
      }
      anonymize_user: {
        Args: { p_user_id: string }
        Returns: string
      }
      fulfill_order: {
        Args: {
          p_amount_cents: number
          p_event_id?: string
          p_order_id: string
          p_provider_billing_id: string
        }
        Returns: string
      }
      has_course_access: {
        Args: {
          p_course_id: string
        }
        Returns: boolean
      }
      is_admin: {
        Args: never
        Returns: boolean
      }
      refund_order: {
        Args: {
          p_event_id?: string
          p_order_id: string
        }
        Returns: string
      }
      reorder_lessons: {
        Args: {
          p_lesson_ids: string[]
          p_module_id: string
        }
        Returns: undefined
      }
      reorder_materials: {
        Args: {
          p_lesson_id: string
          p_material_ids: string[]
        }
        Returns: undefined
      }
      reorder_modules: {
        Args: {
          p_course_id: string
          p_module_ids: string[]
        }
        Returns: undefined
      }
      request_refund: {
        Args: {
          p_order_id: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "student"
      course_level: "beginner" | "intermediate" | "advanced"
      course_status: "draft" | "published" | "archived"
      enrollment_source: "purchase" | "admin_grant"
      material_type: "video" | "text" | "file" | "link"
      order_source: "checkout" | "manual"
      order_status: "pending" | "paid" | "failed" | "expired" | "refunded" | "canceled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Omit<Database, "__InternalSupabase"> },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Omit<Database, "__InternalSupabase">
  }
    ? keyof (Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof Omit<Database, "__InternalSupabase">
}
  ? (Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Omit<Database, "__InternalSupabase"> },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Omit<Database, "__InternalSupabase">
  }
    ? keyof Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof Omit<Database, "__InternalSupabase">
}
  ? Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Omit<Database, "__InternalSupabase"> },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Omit<Database, "__InternalSupabase">
  }
    ? keyof Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof Omit<Database, "__InternalSupabase">
}
  ? Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Omit<Database, "__InternalSupabase"> },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Omit<Database, "__InternalSupabase">
  }
    ? keyof Omit<Database, "__InternalSupabase">[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof Omit<Database, "__InternalSupabase">
}
  ? Omit<Database, "__InternalSupabase">[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Omit<Database, "__InternalSupabase"> },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Omit<Database, "__InternalSupabase">
  }
    ? keyof Omit<Database, "__InternalSupabase">[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof Omit<Database, "__InternalSupabase">
}
  ? Omit<Database, "__InternalSupabase">[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "student"],
      course_level: ["beginner", "intermediate", "advanced"],
      course_status: ["draft", "published", "archived"],
      enrollment_source: ["purchase", "admin_grant"],
      material_type: ["video", "text", "file", "link"],
      order_source: ["checkout", "manual"],
      order_status: ["pending", "paid", "failed", "expired", "refunded", "canceled"],
    },
  },
} as const
