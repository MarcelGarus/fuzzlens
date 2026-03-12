import { FuzzLensContext } from '../types/context';

export default (ctx: FuzzLensContext) => () => {
    if (ctx.providers) {
        ctx.providers.functionsTree.refresh();
        ctx.providers.resultsTree.refresh();
    }
};
