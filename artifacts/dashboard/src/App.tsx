import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import Home from "@/pages/home";
import Leaderboard from "@/pages/leaderboard";
import Profile from "@/pages/profile";
import Admin from "@/pages/admin";
import Login from "@/pages/login";
import Setup from "@/pages/setup";
import Users from "@/pages/users";
import Embeds from "@/pages/embeds";
import Rarities from "@/pages/rarities";
import CustomRarities from "@/pages/custom-rarities";
import Events from "@/pages/events";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/events" component={Events} />
      <Route path="/profile" component={Profile} />
      <Route path="/login" component={Login} />
      <Route path="/setup/:token" component={Setup} />
      <Route path="/admin/users" component={Users} />
      <Route path="/admin/embeds" component={Embeds} />
      <Route path="/admin/rarities" component={Rarities} />
      <Route path="/admin/custom-rarities" component={CustomRarities} />
      <Route path="/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
