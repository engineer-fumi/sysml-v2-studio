package VehicleDefinitions {
    private import ScalarValues::*;

    doc /* 車両の定義ライブラリ。型 (def) のみを置くファイル。 */

    attribute def Torque;
    attribute def FuelLevel;

    item def Fuel;
    item def Power;

    port def FuelPort {
        out item fuel : Fuel;
    }

    port def DrivePort {
        out item power : Power;
        attribute torque : Torque;
    }

    part def Vehicle {
        attribute mass : Real;
    }

    part def Engine {
        port fuelIn : ~FuelPort;
        port drive : DrivePort;
        attribute peakTorque : Torque;
    }

    part def FuelTank {
        port fuelOut : FuelPort;
        attribute capacity : Real;
        attribute level : FuelLevel;
    }

    part def Transmission {
        port driveIn : ~DrivePort;
        port driveOut : DrivePort;
    }

    part def Wheel {
        port hub : ~DrivePort;
        attribute diameter : Real;
    }
}
