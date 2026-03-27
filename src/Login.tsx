import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { signInWithGoogle } from './firebase';
import { motion } from 'motion/react';

export const Login: React.FC = () => {
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
      navigate('/');
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  return (
    <div className="min-h-screen bg-indigo-600 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full max-w-md p-10 rounded-[2.5rem] shadow-2xl text-center"
      >
        <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-8">
          <LogIn size={40} />
        </div>
        <h1 className="text-3xl font-black text-gray-900 mb-2">Gestão Pro</h1>
        <p className="text-gray-500 mb-10">Acesse sua plataforma empresarial completa.</p>
        
        <button 
          onClick={handleLogin}
          className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition-all flex items-center justify-center group"
        >
          <img 
            src="https://www.google.com/favicon.ico" 
            alt="Google" 
            className="w-5 h-5 mr-3 group-hover:scale-110 transition-transform"
            referrerPolicy="no-referrer"
          />
          Entrar com Google
        </button>
        
        <p className="mt-8 text-xs text-gray-400">
          Ao entrar, você concorda com nossos termos de serviço e política de privacidade.
        </p>
      </motion.div>
    </div>
  );
};
