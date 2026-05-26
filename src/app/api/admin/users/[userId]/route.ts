import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
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

    const { userId } = await params
    const body = await request.json()
    const { action } = body

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action. Use "approve" or "reject".' }, { status: 400 })
    }

    const { error } = await admin
      .from('profiles')
      .update({ is_approved: action === 'approve' })
      .eq('user_id', userId)

    if (error) {
      console.error('Error updating user approval:', error)
      return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in admin users POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
