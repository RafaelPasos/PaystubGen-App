'use client';
import { useState } from 'react';
import { useData } from '@/context/DataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { Team } from '@/lib/types';
import { startOfWeek, formatISO } from 'date-fns';

export default function TeamComponent({ team, isAuthenticated }: { team: Team, isAuthenticated: boolean }) {
  const { 
    employees, 
    items, 
    localProduction,
    localRates,
    addEmployee, 
    deleteEmployee,
    handleRateChange,
    handleProductionChange 
  } = useData();
  const [newEmployeeName, setNewEmployeeName] = useState('');

  const teamEmployees = employees.filter(e => e.teamId === team.id);
  const teamItems = items.filter(i => i.teamId === team.id);

  const handleAddEmployee = async () => {
    if (newEmployeeName.trim()) {
      await addEmployee({ name: newEmployeeName, teamId: team.id });
      setNewEmployeeName('');
    }
  };

  const days = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sábado'];

  return (
    <div>
      <div className="bg-white p-6 rounded-2xl shadow-lg mb-8">
        <h2 className="text-2xl font-semibold mb-4 border-b pb-3">{team.name}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {isAuthenticated && (
            <div className="md:col-span-3">
              <label htmlFor={`employeeName-${team.id}`} className="block text-sm font-medium text-gray-700 mb-1">Nombre del nuevo empleado</label>
              <div className="flex space-x-3">
                <Input
                  id={`employeeName-${team.id}`}
                  value={newEmployeeName}
                  onChange={(e) => setNewEmployeeName(e.target.value)}
                  placeholder={`Agregar al grupo de ${team.name.toLowerCase()}`}
                  className="flex-grow w-full p-3"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddEmployee()}
                />
                <Button onClick={handleAddEmployee} className="bg-blue-600 text-white font-semibold px-6 py-3 h-auto rounded-lg shadow-md hover:bg-blue-700">
                  Agregar
                </Button>
              </div>
            </div>
          )}
          {isAuthenticated && (
            <div className="md:col-span-3 mt-4 pt-4 border-t">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {team.name === 'Corazones' ? 'Pago x pieza' : 'Pago por kg'}
              </label>
              <div className={`grid grid-cols-2 ${team.name === 'Corazones' ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-4`}>
                {teamItems.map(item => (
                  <div key={item.id}>
                    <label className="block text-sm font-medium text-gray-600 mb-1">{item.name}</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500">$</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={localRates[item.id] ?? ''}
                        onChange={(e) => handleRateChange(item.id, e.currentTarget.value)}
                        className="w-full pl-7 p-3"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="space-y-8">
        {teamEmployees.length > 0 ? teamEmployees.map(employee => (
          <div key={employee.id} className="bg-white p-6 rounded-2xl shadow-lg">
            <div className="flex justify-between items-center mb-4 border-b pb-4">
              <h3 className="text-2xl font-bold text-gray-800">{employee.name}</h3>
               {isAuthenticated && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                      <Button variant="ghost" className="text-red-500 hover:text-red-700 font-semibold py-2 px-4 rounded-lg hover:bg-red-100 transition">Eliminar</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete {employee.name}.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteEmployee(employee.id, team.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
               )}
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-gray-600">Producción Semanal</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-center">
                  <thead>
                    <tr className="border-b-2">
                      <th className="py-2 px-3 text-left font-medium text-gray-500 text-sm">Tipo</th>
                      {days.map(day => <th key={day} className="py-2 px-1 font-medium text-gray-500 text-sm">{day.substring(0,3)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {teamItems.map(item => {
                      return (
                        <tr key={item.id} className="border-b">
                          <td className="font-semibold py-2 px-3 text-gray-700">{item.name}</td>
                          {days.map((day, dayIndex) => {
                             const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
                             const date = new Date(weekStart);
                             date.setDate(date.getDate() + dayIndex);
                             const dateString = formatISO(date, { representation: 'date' });
                             const entry = Object.values(localProduction).find(p => p.employeeId === employee.id && p.productionItemId === item.id && p.date === dateString);
                             return(
                                <td key={dayIndex} className="p-1">
                                    <Input
                                        type="number"
                                        min="0"
                                        value={entry?.quantity ?? 0}
                                        onChange={(e) => handleProductionChange(employee.id, item.id, dayIndex, e.currentTarget.value)}
                                        className="w-20 p-2"
                                        disabled={!isAuthenticated}
                                    />
                                </td>
                             )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )) : (
            <div className="text-center py-12 bg-white rounded-2xl shadow-lg"><h3 className="text-xl font-medium text-gray-500">No employees added to this team.</h3></div>
        )}
      </div>
    </div>
  );
}
