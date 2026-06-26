package VehicleRequirements {
    private import ScalarValues::*;
    private import VehicleDefinitions::*;
    private import VehicleConfiguration::*;

    doc /* 車両要求。構成・定義を別ファイルから import して参照する。 */

    requirement def MassLimit {
        doc /* 車両総質量は 1500kg 以下であること。 */
        attribute massLimit : Real = 1500.0;
        subject vehicle : Vehicle;
        require constraint { vehicle.mass <= massLimit }
    }

    requirement vehicleMassRequirement : MassLimit {
        subject vehicle;
    }

    satisfy vehicleMassRequirement by VehicleConfiguration::vehicle;
}
