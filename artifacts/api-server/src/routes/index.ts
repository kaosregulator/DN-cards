import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import adminRouter from "./admin";
import storageRouter from "./storage";
import authRouter from "./auth";
import dashboardUsersRouter from "./dashboard-users";
import embedsRouter from "./embeds";
import rarityProfilesRouter from "./rarity-profiles";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/dashboard/users", dashboardUsersRouter);
router.use("/embeds", embedsRouter);
router.use("/rarity-profiles", rarityProfilesRouter);
router.use("/admin", adminRouter);
router.use(storageRouter);
router.use(dashboardRouter);

export default router;
