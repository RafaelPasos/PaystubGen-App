# Paystub Generator Application

This is a web-based application designed to streamline the process of tracking employee production and generating weekly paystubs. It's built for a specific workflow where employee pay is calculated based on the quantity of items they produce, with different rates for different items. The application is designed to be intuitive for data entry clerks while providing secure, role-based access for administrative tasks.

## Key Functionalities

- **Team-Based Data Management:** The entire application is structured around teams (e.g., "Corazones", "Hojas"). Each team has its own set of employees and its own specific list of production items.
- **Weekly Production Tracking:** Users can enter the daily production quantity for each employee across a Monday-to-Saturday work week. The interface is optimized for quick data entry.
- **Dynamic Pay Rate Management:** Administrators (authenticated users) can set and update the pay rate for each production item. These rates are used to calculate the final pay.
- **Employee & Team Management:** Administrators can add new teams and add or remove employees from existing teams. These actions are immediately reflected in the UI without needing a page refresh.
- **Real-time Data Synchronization:** All data is stored in Firebase Firestore and synchronized in real-time. Changes made by one user are instantly visible to others.
- **Secure PDF Paystub Generation:** Authenticated users can generate a consolidated PDF document containing individual, itemized paystubs for every employee for the selected week.
- **State Management & Persistence:**
    - Unsaved changes are tracked, and the user is prompted to save their work with a dedicated "Save Changes" button.
    - A "Reset" button allows users to clear all weekly production numbers to zero for the currently selected team, making it easy to start a new week.
- **Role-Based Access Control:**
    - **Public Access:** Anyone can view employee production numbers and enter new quantities into the input fields.
    - **Admin Access:** A simple, hardcoded password unlocks administrative privileges, which include:
        - Adding or deleting teams.
        - Adding or deleting employees.
        - Modifying pay rates for production items.
        - Generating the final PDF paystubs.

---

## Technical Design & Architecture

This application is a modern, client-rendered web app built with Next.js and the React ecosystem. The architecture prioritizes a responsive user experience, maintainable code, and scalable data management through Firebase.

### Core Technologies

- **Frontend Framework:** [Next.js (App Router)](https://nextjs.org/) with React
- **UI Components:** [ShadCN UI](https://ui.shadcn.com/) - A collection of beautifully designed, accessible, and reusable components.
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) for a utility-first styling workflow.
- **Database & Auth (BaaS):** [Firebase](https://firebase.google.com/) (Firestore for database, Anonymous Auth for user sessions).
- **State Management:** React Context (`DataProvider`) combined with local component state (`useState`).
- **PDF Generation:** `jspdf` and `jspdf-autotable` for client-side PDF creation.
- **Date Handling:** `date-fns` for reliable and consistent date manipulation.

### Architectural Approach

#### 1. Client-Side Rendering (CSR) with `'use client'`
The entire application operates on the client side. This was a deliberate choice to fully leverage Firestore's real-time capabilities. By using `'use client'` at the root of our pages and components, we can directly interact with the Firebase SDK and subscribe to `onSnapshot` listeners. This enables a highly dynamic and responsive UI where data changes from any user are reflected across all connected clients instantly, without requiring manual polling or page reloads.

#### 2. Centralized Data Provider (`DataProvider.tsx`)
The core of the application's state management resides in the `DataProvider`. This React Context provider serves as the single source of truth for all dynamic data and encapsulates all interaction with the backend (Firestore).

**Responsibilities:**
- **Firebase Connection & Listeners:** It initializes and manages nested, real-time `onSnapshot` listeners for all necessary Firestore collections (`teams`, `employees`, `productionItems`, `dailyProduction`). This is the mechanism that enables the real-time, multi-user experience. It intelligently sets up listeners for subcollections as parent data (like teams) is loaded.
- **Data Aggregation & Provision:** It fetches data from multiple collections, aggregates it, and provides a unified, clean state to the rest of the application through the `useData` hook.
- **Mutation Logic:** It encapsulates all data modification logic (`addEmployee`, `deleteEmployee`, `addTeam`, `deleteTeam`, `saveAllChanges`, `resetProduction`). This follows the principle of separation of concerns, keeping UI components clean and focused on presentation. UI components call these functions without needing to know the details of the Firestore implementation.
- **Local "Draft" State Management:** To track unsaved changes, the `DataProvider` maintains a "draft" state using `localRates` and `localProduction` state variables. When a user modifies a pay rate or a production quantity, the change is first stored in this local state. This allows for:
    - A `hasChanges` flag to be set, which conditionally renders the "Save Changes" button.
    - The ability to revert changes or perform batch updates. Changes are only committed to Firestore when the user explicitly clicks "Save".
- **Optimistic UI & Non-Blocking Writes:** To ensure the UI feels instantaneous, Firestore write operations (`setDoc`, `addDoc`, `deleteDoc`, `writeBatch`) are not `await`ed in the main application flow. They are "fire-and-forget" from the UI's perspective. The application immediately proceeds, and the real-time listener is the ultimate source of truth that confirms the update by re-rendering with the new data from the server.

#### 3. Firebase Backend-as-a-Service (BaaS)

##### Firestore Data Structure
The database schema, defined in `docs/backend.json`, is designed for security, scalability, and efficient querying in a multi-team environment.
- **Root Collection (`teams`):** The entire data model is rooted in a top-level `teams` collection. This is the cornerstone of the security model, as it allows Firestore Security Rules to easily ensure a user can only access data for the team they belong to (a common pattern for multi-tenant apps).
- **Nested Subcollections:** Data is logically nested to create clear ownership and enable simple, efficient queries without complex joins. For instance, an employee's production data is stored in a subcollection under that employee, which itself is under a team.
  ```
  /teams/{teamId}/employees/{employeeId}/dailyProduction/{prodId}
  /teams/{teamId}/productionItems/{itemId}
  ```
- **Security Rules:** Although not managed in the frontend code, this structure is designed to work with Firestore Security Rules that would enforce data isolation between teams. For example, a rule for reading `dailyProduction` would look like `allow read: if request.auth != null && get(/databases/$(database)/documents/teams/$(teamId)).data.owner == request.auth.uid;` (simplified example).

##### Authentication
- **Anonymous Authentication:** The app uses Firebase Anonymous Authentication to provide a unique, temporary user session for every visitor. This allows the application to function for public users and provides a `uid` that can be used in security rules, even for non-logged-in users.
- **"Soft" Admin Authentication:** Administrative privileges are granted via a simple, hardcoded password. This is not a true security model but a "soft gate" to hide administrative UI elements. A production-grade application would replace this with Firebase's role-based custom claims.

#### 4. Component Architecture
- **`PaystubApp.tsx`:** The main orchestrator component. It sits just below the `DataProvider`. It manages high-level UI state like the active team tab, the login modal, the "Add Team" modal, and the global action buttons (Reset, Save, Generate PDF).
- **`TeamComponent.tsx`:** This component renders the view for a single team. It consumes data from the `DataProvider` via the `useData` hook. It is responsible for rendering the employee list, their production input tables, and the administrative controls for pay rates and adding/removing employees for that specific team.
- **UI Components (`/components/ui`):** The application heavily relies on pre-built, production-ready components from ShadCN UI. This accelerates development and ensures a consistent, high-quality, and accessible user interface. Components like `Dialog`, `Tabs`, `Input`, and `Button` are used extensively.

#### 5. Error Handling
- A global error-handling system is in place using `error-emitter.ts` and `FirebaseErrorListener.tsx`.
- When a Firestore operation fails due to security rules, a custom `FirestorePermissionError` is thrown.
- This error is caught and emitted globally. The `FirebaseErrorListener` component catches this event and throws the error again, allowing it to be caught by Next.js's development overlay. This provides clear, contextual feedback to the developer during debugging, showing the exact Firestore request that was denied.
