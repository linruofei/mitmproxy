import * as React from "react";
import ModalLayout from "./ModalLayout";
import OptionContent from "./OptionModal";
import VariablesContent from "./VariablesModal";
import RulesView from "../RulesView";

function OptionModal() {
    return (
        <ModalLayout>
            <OptionContent />
        </ModalLayout>
    );
}

function VariablesModal() {
    return (
        <ModalLayout>
            <VariablesContent />
        </ModalLayout>
    );
}

function RulesModal() {
    return (
        <ModalLayout>
            <RulesView />
        </ModalLayout>
    );
}

export default {
    OptionModal,
    VariablesModal,
    RulesModal,
};
