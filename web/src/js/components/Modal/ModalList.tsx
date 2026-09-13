import * as React from "react";
import ModalLayout from "./ModalLayout";
import OptionContent from "./OptionModal";
import VariablesContent from "./VariablesModal";

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

export default {
    OptionModal,
    VariablesModal,
};
