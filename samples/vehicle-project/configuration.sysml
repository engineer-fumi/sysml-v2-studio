package VehicleConfiguration {
    private import VehicleDefinitions::*;

    doc /* 車両の構成 (usage)。定義は definitions.sysml から import。 */

    part vehicle : Vehicle {
        attribute :>> mass = 1200.0;

        part engine : Engine;
        part fuelTank : FuelTank {
            attribute :>> capacity = 50.0;
        }
        part transmission : Transmission;
        part frontWheels : Wheel[2];
        part rearWheels : Wheel[2];

        connect fuelTank.fuelOut to engine.fuelIn;
        connect engine.drive to transmission.driveIn;
        connection driveShaft connect transmission.driveOut to rearWheels.hub;

        flow of Fuel from fuelTank.fuelOut.fuel to engine.fuelIn.fuel;
    }
}
