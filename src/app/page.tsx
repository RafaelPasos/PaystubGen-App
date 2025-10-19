'use client';

import { DataProvider } from '@/context/DataProvider';
import Header from '@/components/Header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Dashboard from '@/components/paystub/Dashboard';
import Employees from '@/components/paystub/Employees';
import Items from '@/components/paystub/Items';
import Production from '@/components/paystub/Production';
import { LayoutDashboard, Users, Package, ClipboardList } from 'lucide-react';

export default function Home() {
  return (
    <DataProvider>
      <div className="flex flex-col min-h-screen bg-background">
        <Header />
        <main className="flex-1 container mx-auto p-4 sm:p-6 md:p-8">
          <Tabs defaultValue="dashboard" className="w-full">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto">
              <TabsTrigger value="dashboard" className="py-2">
                <LayoutDashboard className="w-4 h-4 mr-2" />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="employees" className="py-2">
                <Users className="w-4 h-4 mr-2" />
                Employees
              </TabsTrigger>
              <TabsTrigger value="items" className="py-2">
                <Package className="w-4 h-4 mr-2" />
                Items
              </TabsTrigger>
              <TabsTrigger value="production" className="py-2">
                <ClipboardList className="w-4 h-4 mr-2" />
                Production
              </TabsTrigger>
            </TabsList>
            <TabsContent value="dashboard" className="mt-6">
              <Dashboard />
            </TabsContent>
            <TabsContent value="employees" className="mt-6">
              <Employees />
            </TabsContent>
            <TabsContent value="items" className="mt-6">
              <Items />
            </TabsContent>
            <TabsContent value="production" className="mt-6">
              <Production />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </DataProvider>
  );
}
