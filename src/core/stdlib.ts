/**
 * Minimal subset of the KerML / SysML v2 standard libraries, so that common
 * names (Real, ISQ value types, SI units, base defs ...) resolve without
 * bundling the full OMG library. Modeled after the OMG SysML v2 release
 * libraries, drastically reduced.
 */

export interface StdLibFile {
  name: string;
  source: string;
}

const scalarValues = `library package ScalarValues {
    abstract attribute def ScalarValue;
    abstract attribute def NumericalValue :> ScalarValue;
    attribute def Boolean :> ScalarValue;
    attribute def String :> ScalarValue;
    attribute def Number :> NumericalValue;
    attribute def Complex :> Number;
    attribute def Real :> Complex;
    attribute def Rational :> Real;
    attribute def Integer :> Rational;
    attribute def Natural :> Integer;
    attribute def Positive :> Natural;
}
`;

const base = `library package Base {
    abstract part def Anything;
}

library package Items {
    abstract item def Item;
}

library package Parts {
    abstract part def Part :> Items::Item;
}

library package Ports {
    abstract port def Port;
}

library package Actions {
    abstract action def Action;
}

library package States {
    abstract state def StateAction :> Actions::Action;
}

library package Connections {
    abstract connection def Connection;
    abstract connection def BinaryConnection :> Connection;
}

library package Interfaces {
    abstract interface def Interface :> Connections::BinaryConnection;
}

library package Allocations {
    abstract allocation def Allocation :> Connections::BinaryConnection;
}

library package Constraints {
    abstract constraint def ConstraintCheck;
}

library package Requirements {
    abstract requirement def RequirementCheck :> Constraints::ConstraintCheck;
}

library package Calculations {
    abstract calc def Calculation :> Actions::Action;
}

library package Cases {
    abstract case def Case :> Calculations::Calculation;
}

library package AnalysisCases {
    abstract analysis def AnalysisCase :> Cases::Case;
}

library package VerificationCases {
    abstract verification def VerificationCase :> Cases::Case;
}

library package UseCases {
    abstract use case def UseCase :> Cases::Case;
}

library package Views {
    abstract view def View;
    abstract viewpoint def Viewpoint :> Requirements::RequirementCheck;
    abstract rendering def Rendering;
}

library package Metaobjects {
    abstract metadata def Metaobject;
    metadata def SemanticMetadata :> Metaobject {
        ref baseType;
        attribute isMandatory : ScalarValues::Boolean;
    }
}

library package Flows {
    abstract flow def Flow;
    abstract flow def MessageFlow :> Flow;
}

library package Occurrences {
    abstract occurrence def Occurrence;
}
`;

const quantities = `library package Quantities {
    import ScalarValues::*;
    abstract attribute def TensorQuantityValue :> ScalarValues::NumericalValue;
    abstract attribute def VectorQuantityValue :> TensorQuantityValue;
    abstract attribute def ScalarQuantityValue :> VectorQuantityValue;
    alias QuantityValue for ScalarQuantityValue;
    attribute scalarQuantities : ScalarQuantityValue;
    attribute tensorQuantities : TensorQuantityValue;
}

library package ISQ {
    import Quantities::*;

    attribute def MassValue :> Quantities::ScalarQuantityValue;
    attribute def LengthValue :> Quantities::ScalarQuantityValue;
    attribute def TimeValue :> Quantities::ScalarQuantityValue;
    attribute def DurationValue :> TimeValue;
    attribute def SpeedValue :> Quantities::ScalarQuantityValue;
    attribute def VelocityValue :> Quantities::VectorQuantityValue;
    attribute def AccelerationValue :> Quantities::VectorQuantityValue;
    attribute def ForceValue :> Quantities::VectorQuantityValue;
    attribute def TorqueValue :> Quantities::VectorQuantityValue;
    attribute def PressureValue :> Quantities::ScalarQuantityValue;
    attribute def EnergyValue :> Quantities::ScalarQuantityValue;
    attribute def PowerValue :> Quantities::ScalarQuantityValue;
    attribute def TemperatureValue :> Quantities::ScalarQuantityValue;
    attribute def ElectricCurrentValue :> Quantities::ScalarQuantityValue;
    attribute def ElectricChargeValue :> Quantities::ScalarQuantityValue;
    attribute def VoltageValue :> Quantities::ScalarQuantityValue;
    attribute def ResistanceValue :> Quantities::ScalarQuantityValue;
    attribute def FrequencyValue :> Quantities::ScalarQuantityValue;
    attribute def AreaValue :> Quantities::ScalarQuantityValue;
    attribute def VolumeValue :> Quantities::ScalarQuantityValue;
    attribute def AngleValue :> Quantities::ScalarQuantityValue;
    attribute def AmountOfSubstanceValue :> Quantities::ScalarQuantityValue;
    attribute def LuminousIntensityValue :> Quantities::ScalarQuantityValue;

    // common quantity attribute usages (e.g. \`:> ISQ::mass\`)
    attribute mass : MassValue;
    attribute length : LengthValue;
    attribute time : TimeValue;
    attribute duration : DurationValue;
    attribute speed : SpeedValue;
    attribute velocity : VelocityValue;
    attribute acceleration : AccelerationValue;
    attribute force : ForceValue;
    attribute torque : TorqueValue;
    attribute pressure : PressureValue;
    attribute energy : EnergyValue;
    attribute power : PowerValue;
    attribute temperature : TemperatureValue;
    attribute frequency : FrequencyValue;
    attribute area : AreaValue;
    attribute volume : VolumeValue;
    attribute angle : AngleValue;
    attribute angularMeasure : AngleValue;
    attribute distancePerVolume : Quantities::ScalarQuantityValue;
}

library package Time {
    attribute def DateTime;
    attribute def TimeInstantValue;
    attribute def TimeIntervalValue;
}

library package MeasurementReferences {
    attribute def TensorMeasurementReference;
    attribute def VectorMeasurementReference :> TensorMeasurementReference;
    attribute def ScalarMeasurementReference :> VectorMeasurementReference;
    alias MeasurementReference for TensorMeasurementReference;
    attribute def CoordinateFrame :> VectorMeasurementReference;
    attribute def MeasurementUnit :> ScalarMeasurementReference;
    attribute def SimpleUnit :> MeasurementUnit;
    attribute def DerivedUnit :> MeasurementUnit;
}

library package SIPrefixes {
    attribute def UnitPrefix;
    attribute kilo : UnitPrefix;
    attribute milli : UnitPrefix;
    attribute micro : UnitPrefix;
    attribute mega : UnitPrefix;
    attribute giga : UnitPrefix;
    attribute centi : UnitPrefix;
    attribute nano : UnitPrefix;
}

library package ModelingMetadata {
    enum def StatusKind {
        open;
        tbd;
        tbr;
        tbc;
        closed;
        done;
    }
    metadata def StatusInfo {
        attribute originator : ScalarValues::String;
        attribute owner : ScalarValues::String;
        attribute status : StatusKind;
    }
    metadata def Rationale {
        attribute text : ScalarValues::String;
    }
    metadata def Issue {
        attribute text : ScalarValues::String;
    }
    enum def RiskLevel {
        low;
        medium;
        high;
    }
    metadata def Risk {
        attribute totalRisk : RiskLevel;
        attribute probability : RiskLevel;
        attribute impact : RiskLevel;
    }
    attribute def Level;
}

library package BaseFunctions {
    // expression bodies are treated as opaque text; the packages exist so
    // imports resolve
}

library package NumericalFunctions {
}

library package ScalarFunctions {
}

library package RealFunctions {
}

library package RequirementDerivation {
    metadata def derivation;
    metadata def original;
    metadata def derive;
}

library package SI {
    import ISQ::*;

    attribute kg : ISQ::MassValue;
    attribute g : ISQ::MassValue;
    attribute m : ISQ::LengthValue;
    attribute mm : ISQ::LengthValue;
    attribute cm : ISQ::LengthValue;
    attribute km : ISQ::LengthValue;
    attribute s : ISQ::TimeValue;
    attribute min : ISQ::TimeValue;
    attribute h : ISQ::TimeValue;
    attribute A : ISQ::ElectricCurrentValue;
    attribute K : ISQ::TemperatureValue;
    attribute mol : ISQ::AmountOfSubstanceValue;
    attribute cd : ISQ::LuminousIntensityValue;
    attribute N : ISQ::ForceValue;
    attribute J : ISQ::EnergyValue;
    attribute W : ISQ::PowerValue;
    attribute Hz : ISQ::FrequencyValue;
    attribute Pa : ISQ::PressureValue;
    attribute V : ISQ::VoltageValue;
    attribute ohm : ISQ::ResistanceValue;
    attribute C : ISQ::ElectricChargeValue;
    attribute rad : ISQ::AngleValue;
    attribute deg : ISQ::AngleValue;
}
`;

export const STDLIB_FILES: StdLibFile[] = [
  { name: "ScalarValues.sysml", source: scalarValues },
  { name: "Base.sysml", source: base },
  { name: "Quantities.sysml", source: quantities },
];
