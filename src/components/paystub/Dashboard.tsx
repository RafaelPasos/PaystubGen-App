'use client';

import { useState } from 'react';
import { useData } from '@/context/DataProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { ProductionEntry } from '@/lib/types';
import { addDays, format } from 'date-fns';
import { DollarSign } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Paystub {
  totalPay: number;
  entries: (ProductionEntry & { itemName: string; itemRate: number; pay: number })[];
}

export default function Dashboard() {
  const { employees, items, production } = useData();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: addDays(new Date(), -7), to: new Date() });
  const [paystub, setPaystub] = useState<Paystub | null>(null);

  const handleGeneratePaystub = () => {
    if (!selectedEmployeeId || !dateRange.from || !dateRange.to) {
      return;
    }

    const fromDate = dateRange.from.setHours(0, 0, 0, 0);
    const toDate = dateRange.to.setHours(23, 59, 59, 999);

    const relevantEntries = production.filter(entry => {
      const entryDate = new Date(entry.date).getTime();
      return entry.employeeId === selectedEmployeeId && entryDate >= fromDate && entryDate <= toDate;
    });

    const detailedEntries = relevantEntries.map(entry => {
      const item = items.find(i => i.id === entry.itemId);
      const pay = item ? item.rate * entry.quantity : 0;
      return {
        ...entry,
        itemName: item?.name || 'Unknown Item',
        itemRate: item?.rate || 0,
        pay,
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const totalPay = detailedEntries.reduce((sum, entry) => sum + entry.pay, 0);

    setPaystub({ totalPay, entries: detailedEntries });
  };
  
  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>Generate Paystub</CardTitle>
          <CardDescription>Select an employee and a date range to calculate their pay.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Employee</label>
            <Select onValueChange={setSelectedEmployeeId} value={selectedEmployeeId || ''}>
              <SelectTrigger>
                <SelectValue placeholder="Select an employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map(employee => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">From Date</label>
            <DatePicker date={dateRange.from} setDate={(date) => setDateRange(prev => ({...prev, from: date }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">To Date</label>
            <DatePicker date={dateRange.to} setDate={(date) => setDateRange(prev => ({...prev, to: date }))} />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleGeneratePaystub} disabled={!selectedEmployeeId} className="w-full">
            <DollarSign className="w-4 h-4 mr-2" />
            Generate Paystub
          </Button>
        </CardFooter>
      </Card>

      {paystub && selectedEmployee && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-2xl">Paystub for {selectedEmployee.name}</CardTitle>
            <CardDescription>
              {format(dateRange.from!, 'PPP')} - {format(dateRange.to!, 'PPP')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-72">
            <div className="space-y-4">
              {paystub.entries.length > 0 ? (
                paystub.entries.map(entry => (
                  <div key={entry.id} className="flex justify-between items-center p-2 rounded-md bg-secondary/50">
                    <div>
                      <p className="font-semibold">{entry.itemName}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(entry.date), 'PPP')} &bull; {entry.quantity} units @ ${entry.itemRate.toFixed(2)}
                      </p>
                    </div>
                    <p className="font-semibold text-lg">${entry.pay.toFixed(2)}</p>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-10">No production entries found for this period.</p>
              )}
            </div>
            </ScrollArea>
          </CardContent>
          <CardFooter className="bg-secondary/30 p-6 rounded-b-lg mt-4">
            <div className="flex justify-between items-center w-full">
              <span className="text-xl font-bold">Total Pay</span>
              <span className="text-2xl font-bold text-primary">${paystub.totalPay.toFixed(2)}</span>
            </div>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
