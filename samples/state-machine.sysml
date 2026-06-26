package CoffeeMachine {
    private import ScalarValues::*;
    private import ISQ::*;

    doc /* コーヒーメーカーの状態機械サンプル。 */

    part def CoffeeMaker;

    item def PowerOn;
    item def PowerOff;
    item def BrewButton;
    item def BrewComplete;

    state def BrewingBehavior {
        attribute waterTemp : TemperatureValue;

        entry action initialize;
        then off;

        state off;
        state idle;
        state heating;
        state brewing;

        transition powerOn first off accept sigOn : PowerOn then idle;
        transition startHeat first idle accept sigBrew : BrewButton then heating;
        transition ready first heating if waterTemp >= 92.0 then brewing;
        transition finishBrew first brewing accept sigDone : BrewComplete then idle;
        transition shutdown first idle accept sigOff : PowerOff then off;
    }

    part coffeeMaker : CoffeeMaker {
        exhibit state brewingBehavior : BrewingBehavior;
    }
}
