import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll() { /* proxy handles cookie refresh */ },
        },
      }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = supabaseAdmin()
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: users, error } = await admin
      .from('profiles')
      .select('id, user_id, full_name, email, role, is_approved, avatar_url, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching users:', error)
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }

    return NextResponse.json({ users })
  } catch (error) {
    console.error('Error in admin users GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
