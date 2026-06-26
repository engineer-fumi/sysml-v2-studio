package RobotUseCases {
    doc /* ユースケース図のサンプル。actor / use case / perform を含む。 */

    part def Operator;
    part def Robot;

    use case def OperateRobot {
        subject robot : Robot;
        actor operator : Operator;
    }

    use case def MaintainRobot {
        subject robot : Robot;
        actor operator : Operator;
    }

    use case def CalibrateRobot :> MaintainRobot;

    use case operateRobot : OperateRobot;
    use case maintainRobot : MaintainRobot;

    part operator : Operator {
        perform operateRobot;
        perform maintainRobot;
    }
}
