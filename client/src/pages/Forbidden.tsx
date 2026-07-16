import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { roleLabel } from '@/lib/utils';

export default function Forbidden() {
  const user = useAuth((s) => s.user);
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass max-w-md p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/15 text-rose-400"><Lock className="h-7 w-7" /></span>
        <h1 className="mt-4 text-xl font-bold text-white">Access restricted</h1>
        <p className="mt-2 text-sm text-slate-400">
          Your role{user ? ` (${roleLabel[user.role]})` : ''} doesn't have permission to view this page.
          In Meridian, every surface is scoped to what your role actually needs.
        </p>
        <Link to="/" className="btn-primary mt-6 inline-flex"><ArrowLeft className="h-4 w-4" /> Back to your dashboard</Link>
      </motion.div>
    </div>
  );
}
