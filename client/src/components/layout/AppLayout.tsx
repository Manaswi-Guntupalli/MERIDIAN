import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import CommandPalette from './CommandPalette';
import EmergencyBanner from './EmergencyBanner';
import Toaster from '@/components/Toaster';
import { useRealtime } from '@/hooks/useRealtime';

export default function AppLayout() {
  const [mobileNav, setMobileNav] = useState(false);
  const location = useLocation();
  useRealtime();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {mobileNav && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={() => setMobileNav(false)} />
            <motion.div initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', stiffness: 320, damping: 34 }} className="absolute inset-y-0 left-0">
              <Sidebar mobile onNavigate={() => setMobileNav(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onMenu={() => setMobileNav(true)} />
        <EmergencyBanner />
        <main className="no-scrollbar flex-1 overflow-y-auto px-5 py-8 lg:px-9 lg:py-10">
          {/* Page transition: a short, restrained fade-rise. */}
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto max-w-[1240px]"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      <CommandPalette />
      <Toaster />
    </div>
  );
}
