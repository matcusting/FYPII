import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { hasRole, useAuth } from '../lib/auth'
import { messageOf } from '../lib/api'

const publicLinks = [
  { to: '/', label: '首页' },
  { to: '/listings', label: '找房' },
]

export default function SiteLayout() {
  const { user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const links = [
    ...publicLinks,
    ...(user ? [{ to: '/dashboard', label: '控制台' }, { to: '/favorites', label: '收藏' }, { to: '/profile', label: '个人资料' }] : []),
    ...(hasRole(user, 'STUDENT') ? [{ to: '/roommates', label: '找室友' }, { to: '/requests', label: '请求' }] : []),
    ...(hasRole(user, 'STUDENT', 'LANDLORD') ? [{ to: '/my-listings', label: '我的房源' }] : []),
    ...(hasRole(user, 'ADMIN') ? [{ to: '/admin', label: '管理后台' }] : []),
  ]
  const logout = async () => {
    try {
      setError('')
      await signOut()
      navigate('/')
    } catch (failure) { setError(messageOf(failure)) }
  }
  return <div className="site-shell">
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className="site-header">
      <div className="container nav-inner">
        <Link className="brand" to="/" onClick={() => setMenuOpen(false)} aria-label="UTS Housing 首页">UTS <span>Housing</span></Link>
        <button className="menu-button" type="button" aria-label={menuOpen ? '关闭菜单' : '打开菜单'} aria-expanded={menuOpen} aria-controls="site-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? '✕' : '☰'}</button>
        <nav id="site-nav" aria-label="主导航" className={`nav-links ${menuOpen ? 'is-open' : ''}`}>
          {links.map(link => <NavLink key={link.to} to={link.to} onClick={() => setMenuOpen(false)} className={({ isActive }) => isActive ? 'nav-link is-active' : 'nav-link'} end={link.to === '/'}>{link.label}</NavLink>)}
          {user ? <button type="button" className="nav-link nav-action" onClick={() => { setMenuOpen(false); void logout() }}>退出登录</button> : <>
            <NavLink to="/login" className="nav-link" onClick={() => setMenuOpen(false)}>登录</NavLink>
            <Link to="/register" className="button button-small" onClick={() => setMenuOpen(false)}>注册</Link>
          </>}
        </nav>
      </div>
      {error && <div role="alert" className="container notice-error">{error}</div>}
    </header>
    <main id="main"><Suspense fallback={<div className="container py-16" role="status">正在加载页面…</div>}><Outlet /></Suspense></main>
    <footer className="site-footer"><div className="container footer-inner"><span>UTS Housing & Roommate Finder</span><nav aria-label="页脚"><Link to="/help">帮助</Link><Link to="/privacy">隐私</Link><Link to="/terms">条款</Link></nav></div></footer>
  </div>
}
