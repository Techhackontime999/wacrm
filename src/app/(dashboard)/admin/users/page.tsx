"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useRouter } from 'next/navigation'
import { Shield, Check, X, RefreshCw, UserCheck, UserX } from 'lucide-react'

interface UserRecord {
  id: string
  user_id: string
  full_name: string
  email: string
  role: string
  is_approved: boolean | null
  avatar_url: string | null
  created_at: string
}

export default function AdminUsersPage() {
  const { profile } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users')
      if (res.status === 403) {
        router.push('/dashboard')
        return
      }
      if (!res.ok) {
        throw new Error('Failed to fetch users')
      }
      const data = await res.json()
      setUsers(data.users ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleAction = async (userId: string, action: 'approve' | 'reject') => {
    setActionLoading(userId)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to update user')
      }
      setUsers(prev =>
        prev.map(u =>
          u.user_id === userId ? { ...u, is_approved: action === 'approve' } : u
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            User Management
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Approve or reject user accounts
          </p>
        </div>
        <button
          type="button"
          onClick={fetchUsers}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--hover-bg)', color: 'var(--text-primary)' }}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && users.length === 0 ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg"
              style={{ background: 'var(--hover-bg)' }}
            />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-2xl border p-12 text-center"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <Shield className="h-12 w-12" style={{ color: 'var(--text-secondary)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            No users found.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--hover-bg)' }}>
                <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>User</th>
                <th className="hidden px-4 py-3 text-left font-medium md:table-cell" style={{ color: 'var(--text-secondary)' }}>Role</th>
                <th className="hidden px-4 py-3 text-left font-medium sm:table-cell" style={{ color: 'var(--text-secondary)' }}>Status</th>
                <th className="hidden px-4 py-3 text-left font-medium lg:table-cell" style={{ color: 'var(--text-secondary)' }}>Joined</th>
                <th className="px-4 py-3 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-t transition-colors hover:bg-[var(--hover-bg)]/50"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium"
                        style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                      >
                        {u.full_name?.charAt(0)?.toUpperCase() ?? u.email?.charAt(0)?.toUpperCase() ?? 'U'}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>
                          {u.full_name || 'Unknown'}
                        </p>
                        <p className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {u.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{
                        background: u.role === 'admin' ? 'var(--primary-soft)' : 'var(--hover-bg)',
                        color: u.role === 'admin' ? 'var(--primary)' : 'var(--text-secondary)',
                      }}
                    >
                      {u.role === 'admin' && <Shield className="h-3 w-3" />}
                      {u.role}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    {u.is_approved ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: '#22c55e' }}>
                        <Check className="h-3.5 w-3.5" />
                        Approved
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: '#f97316' }}>
                        <X className="h-3.5 w-3.5" />
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-xs lg:table-cell" style={{ color: 'var(--text-secondary)' }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u.role !== 'admin' && (
                      <div className="flex items-center justify-end gap-2">
                        {!u.is_approved ? (
                          <button
                            type="button"
                            onClick={() => handleAction(u.user_id, 'approve')}
                            disabled={actionLoading === u.user_id}
                            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ background: '#22c55e' }}
                          >
                            {actionLoading === u.user_id ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <UserCheck className="h-3.5 w-3.5" />
                            )}
                            <span className="hidden sm:inline">Approve</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAction(u.user_id, 'reject')}
                            disabled={actionLoading === u.user_id}
                            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            style={{
                              background: 'var(--hover-bg)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {actionLoading === u.user_id ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <UserX className="h-3.5 w-3.5" />
                            )}
                            <span className="hidden sm:inline">Revoke</span>
                          </button>
                        )}
                      </div>
                    )}
                    {u.role === 'admin' && (
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        —
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
