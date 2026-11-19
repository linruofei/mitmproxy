import * as React from "react";
import classnames from "classnames";
import Icon from "./Icon";
import type { IconName } from "./Icon";

export interface ButtonProps {
    onClick: () => void;
    children?: React.ReactNode;
    icon?: IconName;
    iconClassName?: string;
    disabled?: boolean;
    className?: string;
    style?: React.CSSProperties;
    title?: string;
}

export default function Button({
    onClick,
    children,
    icon,
    iconClassName,
    disabled,
    className,
    style,
    title,
}: ButtonProps) {
    return (
        <button
            className={classnames(className, "btn btn-default")}
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            style={style}
            title={title}
        >
            {icon && (
                <>
                    <Icon name={icon} className={iconClassName} />
                    &nbsp;
                </>
            )}
            {children}
        </button>
    );
}
