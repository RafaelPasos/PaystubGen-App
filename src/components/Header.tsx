'use client';

import { Button } from '@/components/ui/button';
import { LogIn, PlusCircle } from 'lucide-react';

type HeaderProps = {
  isAuthenticated: boolean;
  onLoginClick: () => void;
  onAddTeamClick: () => void;
};

export default function Header({ isAuthenticated, onLoginClick, onAddTeamClick }: HeaderProps) {
  return (
    <header className="bg-white shadow-md">
      <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
        <div className="w-1/4">
          {/* This space is now empty */}
        </div>
        <h1 className="text-4xl font-bold text-left text-gray-900 w-1/2">
          GENERADOR DE RECIBOS DE PAGO
        </h1>
        <div className="w-1/8 flex justify-end">
          {isAuthenticated ? (
            <Button onClick={onAddTeamClick} variant="outline" className="flex items-center gap-2">
              <PlusCircle size={18} />
              <span>Agregar Grupo</span>
            </Button>
          ) : (
            <Button onClick={onLoginClick} variant="outline" className="flex items-center gap-2">
              <LogIn size={18} />
              <span>Entrar</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
