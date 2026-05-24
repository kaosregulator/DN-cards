import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/admin", adminRouter);
router.use(dashboardRouter);

export default router;
