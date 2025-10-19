'use client';

import { DataProvider } from '@/context/DataProvider';
import PaystubApp from '@/components/paystub/PaystubApp';


export default function Home() {
  return (
    <DataProvider>
      <PaystubApp />
    </DataProvider>
  );
}
