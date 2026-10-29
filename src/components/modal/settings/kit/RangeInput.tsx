import React from 'react';
import { sliderValueOnTrack, useSliderGesture } from './sliderGesture';

// src/components/modal/settings/kit/RangeInput.tsx
// A native range input wearing the slider's gesture test (sliderGesture): a finger that comes down
// on the track and then travels up or down the page is scrolling, and the value stays put. The rows
// that still dress their own slider, rather than take the kit's, come through here.

type RangeInputProps = {
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    /** The caller's own dressing of the track. */
    className?: string;
    ariaLabel?: string;
    disabled?: boolean;
};

export const RangeInput: React.FC<RangeInputProps> = ({ value, min, max, step = 1, onChange, className, ariaLabel, disabled }) => {
    const { inputRef, handlers } = useSliderGesture({ min, max, step, onChange, disabled });
    return (
        <input
            ref={inputRef}
            type="range"
            {...handlers}
            aria-label={ariaLabel}
            min={min}
            max={max}
            step={step}
            value={sliderValueOnTrack(value, min, max, step)}
            disabled={disabled}
            className={`st-slider${className ? ` ${className}` : ''}`}
        />
    );
};

export default RangeInput;
