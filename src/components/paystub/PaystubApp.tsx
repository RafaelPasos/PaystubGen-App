'use client';

import Header from '@/components/Header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TeamComponent from '@/components/paystub/TeamComponent';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { useState } from 'react';
import { useData } from '@/context/DataProvider';
import { jsPDF } from "jspdf";
import 'jspdf-autotable';
import { useToast } from '@/hooks/use-toast';
import { startOfWeek, formatISO } from 'date-fns';
import Loading from '@/app/loading';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// Extend jsPDF with autoTable - this is a workaround for module augmentation in a single file
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    autoTableSetLastY: (y: number) => void;
    lastAutoTable: { finalY: number };
  }
}

const SOFT_PASSWORD = "password"; // A simple, hardcoded password

export default function PaystubApp() {
  const [payDate, setPayDate] = useState<Date | undefined>(new Date());
  const { employees, items, production, teams, loading, hasChanges, saveAllChanges, resetProduction } = useData();
  const { toast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);


  const handleLogin = () => {
    if (password === SOFT_PASSWORD) {
      setIsAuthenticated(true);
      setIsLoginModalOpen(false); // Close modal on successful login
      setPassword(''); // Clear password
      toast({ title: "Exito", description: "Contraseña correcta" });
    } else {
      toast({ title: "Error", description: "Contraseña incorrecta", variant: "destructive" });
    }
  };

  const handleSaveChanges = async () => {
    try {
        await saveAllChanges();
        toast({ title: "Exito", description: "Cambios guardados." });
    } catch(e) {
        toast({ title: "Error", description: "No se pudieron guardar los cambios.", variant: "destructive" });
    }
  };

  const generatePDF = () => {
    if (!isAuthenticated) {
      setIsLoginModalOpen(true);
      return;
    }
    if (hasChanges) {
      toast({ title: "Cambios sin guardar", description: "Por favor guarde sus cambios antes de generar el PDF.", variant: "destructive" });
      return;
    }
    if (!payDate) {
      toast({ title: "Error", description: "Por favor selecione una fecha", variant: "destructive" });
      return;
    }
    if (employees.length === 0) {
      toast({ title: "Error", description: "Agrega al menos un empleado para crear el reporte", variant: "destructive" });
      return;
    }

    const doc = new jsPDF();
    const formattedPayDate = new Date(payDate.getTime() - (payDate.getTimezoneOffset() * 60000 ))
      .toISOString()
      .split('T')[0];

    let currentY = 15;
    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomMargin = 20;

    const days = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sábado'];

    teams.forEach(team => {
      const teamEmployees = employees.filter(e => e.teamId === team.id);
      const teamItems = items.filter(i => i.teamId === team.id);

      teamEmployees.forEach(employee => {
        const estimatedHeight = 35 + (teamItems.length * 6);
        if (currentY + estimatedHeight > pageHeight - bottomMargin) {
          doc.addPage();
          currentY = 15;
        }

        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.text("Recibo de pago", 14, currentY);

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(`Grupo: ${team.name}`, 200, currentY, { align: 'right' });
        currentY += 7;

        doc.setFontSize(12);
        doc.text(`${employee.name}`, 14, currentY);
        doc.text(`Fecha: ${formattedPayDate}`, 200, currentY, { align: 'right' });
        currentY += 2;
        
        const employeeProduction = production.filter(p => p.employeeId === employee.id);

        let totalWeeklyPay = 0;
        const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

        const tableBody = teamItems.map(item => {
            const itemProductionEntries = employeeProduction.filter(p => p.productionItemId === item.id);
            const productionByDay = days.map((_, dayIndex) => {
              const date = new Date(weekStart);
              date.setDate(date.getDate() + dayIndex);
              const dateString = formatISO(date, { representation: 'date' });
              const entry = itemProductionEntries.find(p => p.date === dateString);
              return entry ? entry.quantity : 0;
            });

            const totalUnits = productionByDay.reduce((sum, count) => sum + count, 0);
            const rate = item.payRate;
            const subtotal = totalUnits * rate;
            totalWeeklyPay += subtotal;

            return [item.name, ...productionByDay, totalUnits, `$${rate.toFixed(2)}`, `$${subtotal.toFixed(2)}`];
        });

        doc.autoTable({
            head: [['Tipo', ...days, 'Cantidad', (team.name.includes("Corazones"))?'Pago x pza':'Pago x kg', 'Subtotal']],
            body: tableBody,
            startY: currentY,
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185], textColor: 255 },
            styles: { fontSize: 8, cellPadding: 1.5 },
            columnStyles: { 
                0: { fontStyle: 'bold' }, 
                7: { halign: 'right' }, 
                8: { halign: 'right' },
                9: { halign: 'right', fontStyle: 'bold' } 
            }
        });

        currentY = doc.lastAutoTable.finalY;
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text(`Pago Total de la Semana: $${totalWeeklyPay.toFixed(2)}`, 14, currentY + 12);

        currentY += 25;
      });
    });

    doc.save(`recibos_${formattedPayDate.replace(/-/g, '_')}.pdf`);
  };

  if (loading) {
    return <Loading />;
  }

  return (
      <div className="flex flex-col min-h-screen bg-gray-100 text-gray-800">
        <Header onLoginClick={() => setIsLoginModalOpen(true)} />
        <main className="flex-1 max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 w-full">
          <Dialog open={isLoginModalOpen} onOpenChange={setIsLoginModalOpen}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Contraseña</DialogTitle>
                <DialogDescription>
                  Ingrese contraseña para acceder e imprimir recibos.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                 <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Ingrese contraseña"
                    className="w-full p-3"
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  />
              </div>
              <DialogFooter>
                <Button onClick={handleLogin} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg shadow-lg hover:bg-blue-700 text-lg h-auto">
                  Entrar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>


          <div className="bg-white p-6 rounded-2xl shadow-lg mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-center">Fecha de pago</h2>
            <div className="max-w-xs mx-auto">
              <DatePicker date={payDate} setDate={setPayDate} />
            </div>
          </div>
          
          <Tabs defaultValue="Corazones Salitre" className="w-full">
            <TabsList className="grid w-full grid-cols-4 h-auto mb-8">
              {teams.map(team => (
                 <TabsTrigger key={team.id} value={team.name} className="text-lg font-semibold py-3 px-8 transition-colors duration-300 data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                  {team.name}
                 </TabsTrigger>
              ))}
            </TabsList>
            {teams.map(team => (
               <TabsContent key={team.id} value={team.name}>
                <TeamComponent team={team} isAuthenticated={isAuthenticated} />
              </TabsContent>
            ))}
          </Tabs>

          <footer className="mt-12 text-center flex justify-center items-center gap-4">
            <Button onClick={resetProduction} variant="outline" className="bg-white text-gray-700 font-bold px-10 py-4 rounded-lg shadow-xl hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 transition-transform transform hover:scale-105 text-lg h-auto">
                REINICIAR
            </Button>
            {hasChanges && (
                <Button onClick={handleSaveChanges} className="bg-yellow-500 text-white font-bold px-10 py-4 rounded-lg shadow-xl hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 transition-transform transform hover:scale-105 text-lg h-auto">
                    GUARDAR CAMBIOS
                </Button>
            )}
            {isAuthenticated && (
              <Button onClick={generatePDF} className="bg-green-600 text-white font-bold px-10 py-4 rounded-lg shadow-xl hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-transform transform hover:scale-105 text-lg h-auto">
                  GENERAR RECIBOS
              </Button>
            )}
          </footer>
        </main>
      </div>
  );
}
