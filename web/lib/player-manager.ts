/**
 * Global player manager to expose the react-player instance
 */
let playerInstance: any = null;

export const setPlayerInstance = (instance: any) => {
  playerInstance = instance;
};

export const getPlayerInstance = () => playerInstance;
