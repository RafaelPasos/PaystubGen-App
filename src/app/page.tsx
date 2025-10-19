'use client';

import { DataProvider } from '@/context/DataProvider';
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

// Extend jsPDF with autoTable - this is a workaround for module augmentation in a single file
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    autoTableSetLastY: (y: number) => void;
    lastAutoTable: { finalY: number };
  }
}


export default function Home() {
  const [payDate, setPayDate] = useState<Date | undefined>(new Date());
  const { employees, items, production, teams } = useData();
  const { toast } = useToast();

  const generatePDF = () => {
    if (!payDate) {
      toast({ title: "Error", description: "Please select a pay date.", variant: "destructive" });
      return;
    }
    if (employees.length === 0) {
      toast({ title: "Error", description: "Add at least one employee to generate a report.", variant: "destructive" });
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
        const tableBody = teamItems.map(item => {
            const itemProductionEntries = employeeProduction.filter(p => p.productionItemId === item.id);
            const productionByDay = days.map((_, dayIndex) => {
              const entry = itemProductionEntries.find(p => new Date(p.date).getDay() === (dayIndex + 1) % 7); // Adjust for week start
              return entry ? entry.quantity : 0;
            });

            const totalUnits = productionByDay.reduce((sum, count) => sum + count, 0);
            const rate = item.payRate;
            const subtotal = totalUnits * rate;
            totalWeeklyPay += subtotal;

            return [item.name, ...productionByDay, totalUnits, `$${rate.toFixed(2)}`, `$${subtotal.toFixed(2)}`];
        });

        doc.autoTable({
            head: [['Tipo', ...days, 'Cantidad', (team.name === "Corazones")?'Pago x pza':'Pago x kg', 'Subtotal']],
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

    doc.save(`paystubs_${formattedPayDate.replace(/-/g, '_')}.pdf`);
  };

  return (
    <DataProvider>
      <div className="flex flex-col min-h-screen bg-gray-100 text-gray-800">
        <Header />
        <main className="flex-1 max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 w-full">
          <div className="bg-white p-6 rounded-2xl shadow-lg mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-center">Fecha de pago</h2>
            <div className="max-w-xs mx-auto">
              <DatePicker date={payDate} setDate={setPayDate} />
            </div>
          </div>
          
          <Tabs defaultValue="Corazones" className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-auto mb-8">
              {teams.map(team => (
                 <TabsTrigger key={team.id} value={team.name} className="text-lg font-semibold py-3 px-8 transition-colors duration-300 data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                  {team.name}
                 </TabsTrigger>
              ))}
            </TabsList>
            {teams.map(team => (
               <TabsContent key={team.id} value={team.name}>
                <TeamComponent team={team} />
              </TabsContent>
            ))}
          </Tabs>

          <footer className="mt-12 text-center">
            <Button onClick={generatePDF} className="bg-green-600 text-white font-bold px-10 py-4 rounded-lg shadow-xl hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-transform transform hover:scale-105 text-lg h-auto">
                GENERAR RECIBOS
            </Button>
          </footer>
        </main>
      </div>
    </DataProvider>
  );
}
