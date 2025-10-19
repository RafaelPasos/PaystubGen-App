import { Button } from '@/components/ui/button';
import { LogIn } from 'lucide-react';

type HeaderProps = {
  onLoginClick: () => void;
};

export default function Header({ onLoginClick }: HeaderProps) {
  return (
    <header className="bg-white shadow-md">
      <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
        <div className="w-1/4"></div>
        <h1 className="text-4xl font-bold text-center text-gray-900 w-1/2">
          GENERADOR DE RECIBOS DE PAGO
        </h1>
        <div className="w-1/4 flex justify-end">
           <Button onClick={onLoginClick} variant="outline" className="flex items-center gap-2">
            <LogIn size={18} />
            <span>Entrar</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
