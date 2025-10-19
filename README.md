# Paystub Generator Application

This is a web-based application designed to streamline the process of tracking employee production and generating weekly paystubs. It's built for a specific workflow where employee pay is calculated based on the quantity of items they produce, with different rates for different items. The application is designed to be intuitive for data entry clerks while providing secure, role-based access for administrative tasks.

## Live Demo
### https://studio-6461357104-730f1.web.app/


## Key Functionalities

- **Team-Based Data Management:** The entire application is structured around teams (e.g., "Corazones", "Hojas"). Each team has its own set of employees and its own specific list of production items.
- **Weekly Production Tracking:** Users can enter the daily production quantity for each employee across a Monday-to-Saturday work week. The interface is optimized for quick data entry.
- **Dynamic Pay Rate Management:** Administrators (authenticated users) can set and update the pay rate for each production item. These rates are used to calculate the final pay.
- **Employee Management:** Administrators can add new employees to a team or remove existing ones. These actions are immediately reflected in the UI without needing a page refresh.
- **Real-time Data Synchronization:** All data is stored in Firebase Firestore and synchronized in real-time. Changes made by one user are instantly visible to others.
- **Secure PDF Paystub Generation:** Authenticated users can generate a consolidated PDF document containing individual, itemized paystubs for every employee for the selected week.
- **State Management & Persistence:**
    - Unsaved changes are tracked, and the user is prompted to save their work with a dedicated "Save Changes" button.
    - A "Reset" button allows users to clear all weekly production numbers to zero, making it easy to start a new week.
- **Role-Based Access Control:**
    - **Public Access:** Anyone can view employee production numbers and enter new quantities.
    - **Admin Access:** A simple password unlocks administrative privileges, which include:
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
- **Database & Auth:** [Firebase](https://firebase.google.com/) (Firestore for database, Anonymous Auth for user sessions).
- **State Management:** React Context (`DataProvider`) combined with local component state (`useState`).
- **PDF Generation:** `jspdf` and `jspdf-autotable` for client-side PDF creation.
- **Date Handling:** `date-fns` for reliable and consistent date manipulation.

### Architectural Approach

#### 1. Client-Side Rendering (CSR) with `'use client'`
The entire application operates on the client side. This was a deliberate choice to leverage Firestore's real-time capabilities. All components that interact with Firebase or manage state are marked with the `'use client'` directive.

#### 2. Centralized Data Provider (`DataProvider.tsx`)
The core of the application's state management resides in the `DataProvider`. This context provider is responsible for:
- **Firebase Connection:** Initializing and managing the connection to Firestore.
- **Real-time Listeners:** Setting up `onSnapshot` listeners for all necessary Firestore collections (`teams`, `employees`, `productionItems`, `dailyProduction`). This is the mechanism that enables real-time updates.
- **Data Aggregation:** Fetching data from multiple collections and providing it as a unified, clean state to the rest of the application.
- **Mutation Logic:** Encapsulating all data modification logic (`addEmployee`, `deleteEmployee`, `saveAllChanges`, `resetProduction`). This keeps the UI components clean and focused on presentation.
- **Local State Management:** It manages a "draft" state (`localRates`, `localProduction`) to track unsaved changes, only committing them to Firestore when the user explicitly saves.

#### 3. Firestore Data Structure
The database schema in `docs/backend.json` is designed for security and scalability.
- **Nested Collections:** Data is logically nested. For instance, an employee's `dailyProduction` is stored in a subcollection under that employee's document. This keeps queries efficient and security rules simple.
  ```
  /teams/{teamId}/employees/{employeeId}/dailyProduction/{prodId}
  ```
- **Team-Based Segregation:** All primary data (employees, items) is nested under a top-level `teams` collection. This is the cornerstone of the security model, as it allows security rules to easily ensure a user can only access data for the team they belong to.

#### 4. Non-Blocking & Optimistic UI Updates
To ensure the UI feels instantaneous, several patterns are used:
- **Non-Blocking Writes:** Firestore write operations (`setDoc`, `addDoc`, `deleteDoc`) are not awaited in the main application flow. They are "fire-and-forget" from the UI's perspective. The real-time listener is the source of truth that confirms the update.
- **Optimistic UI:** For actions like deleting an employee, the local state is updated immediately (`setEmployees(prev => prev.filter(...))`), so the UI reflects the change instantly, even before the database confirms the deletion. This creates a much smoother user experience.
- **Error Handling:** A global error emitter (`error-emitter.ts`) and listener (`FirebaseErrorListener.tsx`) are used to catch and display Firestore permission errors, providing clear feedback during development.

#### 5. Component Architecture
- **`PaystubApp.tsx`:** The main orchestrator component. It manages high-level UI state like the login modal and the pay date, and it renders the team tabs.
- **`TeamComponent.tsx`:** Renders the view for a single team, including the list of employees, their production inputs, and the administrative controls for pay rates. It consumes data from the `DataProvider`.
- **UI Components (`/components/ui`):** The application heavily relies on pre-built, production-ready components from ShadCN UI, which are then customized as needed.
