'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [users, setUsers] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const [weekInfo, setWeekInfo] = useState({ todayStr: '', weekNum: 0, range: '' });

  useEffect(() => {
    const d = new Date();
    // Calculate week number
    const d2 = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d2.setUTCDate(d2.getUTCDate() + 4 - (d2.getUTCDay()||7));
    const yearStart = new Date(Date.UTC(d2.getUTCFullYear(),0,1));
    const weekNum = Math.ceil((((d2.getTime() - yearStart.getTime()) / 86400000) + 1)/7);

    // Monday to Friday
    const day = d.getDay();
    const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diffToMonday);
    
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    
    const formatDate = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;
    const todayStr = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;

    setWeekInfo({ todayStr, weekNum, range: `${formatDate(monday)} ~ ${formatDate(friday)}` });
    
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (Array.isArray(data)) {
        setUsers(data);
      } else {
        console.error('API Error:', data);
        setUsers([]);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    
    await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() })
    });
    setNewName('');
    fetchUsers();
  };

  const removeUser = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('팀원을 삭제하시겠습니까?')) return;
    await fetch(`/api/users?id=${id}`, { method: 'DELETE' });
    fetchUsers();
  };

  const handleSelectUser = (id: number, name: string) => {
    // Navigate to write page with user context (can just use query params for simplicity)
    router.push(`/write?userId=${id}&name=${encodeURIComponent(name)}`);
  };

  return (
    <div className="glass-panel" style={{ padding: '3rem', maxWidth: '800px', margin: '2rem auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>주간보고 시스템</h1>
        {weekInfo.weekNum > 0 && (
          <p style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem', display: 'inline-block' }}>
            오늘은 {weekInfo.todayStr} <br/>
            현재 {weekInfo.weekNum}주차 ({weekInfo.range}) 입니다.
          </p>
        )}
        <p style={{ color: 'var(--text-muted)' }}>자신의 이름을 선택하여 주간보고를 작성해주세요.</p>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center' }}>로딩중...</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '3rem' }}>
          {users.map(user => (
            <div 
              key={user.id}
              onClick={() => handleSelectUser(user.id, user.name)}
              style={{
                padding: '1.5rem',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.6)',
                transition: 'all 0.2s',
                position: 'relative'
              }}
              onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              <h3 style={{ margin: 0 }}>{user.name}</h3>
              <button 
                onClick={(e) => removeUser(user.id, e)}
                style={{
                  position: 'absolute', top: '8px', right: '8px',
                  background: 'transparent', border: 'none',
                  color: 'red', cursor: 'pointer', opacity: 0.5, fontSize: '0.8rem'
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {users.length === 0 && <p style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text-muted)' }}>등록된 팀원이 없습니다.</p>}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem' }}>팀원 추가</h3>
        <form onSubmit={addUser} style={{ display: 'flex', gap: '1rem' }}>
          <input 
            type="text" 
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="이름을 입력하세요"
            className="input-field"
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary" style={{ padding: '0 2rem' }}>추가</button>
        </form>
      </div>
    </div>
  );
}
