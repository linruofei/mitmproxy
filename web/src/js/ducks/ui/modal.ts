import { createSlice, PayloadAction } from "@reduxjs/toolkit";

const defaultState: {
    activeModal: string | undefined;
    modalData?: any;
} = {
    activeModal: undefined,
    modalData: undefined,
};

const modalSlice = createSlice({
    name: "ui/modal",
    initialState: defaultState,
    reducers: {
        setActiveModal(
            state,
            action: PayloadAction<string | { name: string; data?: any }>
        ) {
            if (typeof action.payload === "string") {
                state.activeModal = action.payload;
                state.modalData = undefined;
            } else {
                state.activeModal = action.payload.name;
                state.modalData = action.payload.data;
            }
        },
        hideModal(state) {
            state.activeModal = undefined;
            state.modalData = undefined;
        },
    },
});

const { actions, reducer } = modalSlice;
export const HIDE_MODAL = modalSlice.actions.hideModal.type;
export const { setActiveModal, hideModal } = actions;
export default reducer;
