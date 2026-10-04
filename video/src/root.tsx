import React from 'react';
import {Composition} from 'remotion';
import {Film} from './film';

export const FPS = 60;
export const DURATION_SECONDS = 168;

export const Root: React.FC = () => (
  <>
    <Composition
      id="Film"
      component={Film}
      durationInFrames={DURATION_SECONDS * FPS}
      fps={FPS}
      width={1920}
      height={1080}
    />
  </>
);
