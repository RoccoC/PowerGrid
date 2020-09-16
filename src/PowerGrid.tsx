import React from 'react';
import styled from '@emotion/styled';
import { GridViewModel, Cell, CellViewModel, Position } from './types';

// TODO: this probably needs to change per browser.  Probably should auto calculate.
const SCROLLBAR_SIZE = 15;

type CellMeta = Position & {
  width: number,
  height: number,
  visible: boolean;
  // direction of cell relative to center of grid
  direction: Position;
};

type GridMeta = Position & {
  colWidths: number[];
  rowHeights: number[];
  colStarts: number[];
  rowStarts: number[];
  innerWidth: number;
  innerHeight: number;
  colHeaderHeights: number[];
  totalColHeaderHeight: number;
  rowHeaderWidths: number[];
  totalRowHeaderWidth: number;
  colFooterHeights: number[];
  totalColFooterHeight: number;
  rowFooterWidths: number[];
  totalRowFooterWidth: number;
};

type InternalCell = Cell<CellViewModel> & {
  col: number;
  row: number;
};

enum CellType {
  ColumnHeader = 'columnheader',
  ColumnFooter = 'columnfoot',
  GridCell = 'gridcell',
  HeaderIntersectionLeft = 'headerintersectionleft',
  HeaderIntersectionRight = 'headerintersectionright',
  FooterIntersectionLeft = 'footerintersectionleft',
  FooterIntersectionRight = 'footerintersectionright',
  RowHeader = 'rowheader',
  RowFooter = 'rowfooter',
};

const Container = styled.div({
  position: 'relative',
  overflow: 'hidden',
});

const ShadowGrid = styled.div<{
  hideScrollbars?: boolean;
  colHeaderHeight?: number;
  rowHeaderWidth?: number;
  colFooterHeight?: number;
  rowFooterWidth?: number;
}>(({ colHeaderHeight = 0, rowHeaderWidth = 0, colFooterHeight = 0, rowFooterWidth = 0 }) => ({
  // TODO: do we actually need to size the shadow grid to the body? what will this do to scrollbars?
  width: `calc(100% - ${rowHeaderWidth + rowFooterWidth}px)`,
  height: `calc(100% - ${colHeaderHeight + colFooterHeight}px)`,
  top: `${colHeaderHeight}px`,
  left: `${rowHeaderWidth}px`,
  bottom: `${colFooterHeight}px`,
  right: `${rowFooterWidth}px`,
  overflow: 'auto',
  position: 'absolute',
}), ({ hideScrollbars }) => hideScrollbars && ({
  msOverflowStyle: 'none', /* Internet Explorer 10+ */
  scrollbarWidth: 'none',    /* Firefox */
  '&::-webkit-scrollbar': { 
    display: 'none',  /* Safari and Chrome */
  },
}));

const ShadowGridContent = styled.div({
  position: 'absolute',
});

const GridViewport = styled.table({
  position: 'relative',
  display: 'block',
  overflow: 'hidden',
});

const GridRow = styled.tr({
  position: 'absolute',
});

const GridCell = styled.td<{ width: number; height: number; }>(({ width, height }) => ({
  width: `${width}px`,
  height: `${height}px`,
  position: 'absolute',
  overflow: 'hidden',
}));

const GridHeaderCell = styled(GridCell.withComponent('th'))({
  zIndex: 1,
});

export type PowerGridProps<T extends CellViewModel, H extends CellViewModel = T> = {
  viewModel: GridViewModel<T, H>;
  onCellClick?: (event: React.MouseEvent<HTMLElement>) => void;
  onScroll?: (scrollPosition: Position) => void;
  role?: 'grid' | 'treegrid',
};

class PowerGrid<T extends CellViewModel = CellViewModel, H extends CellViewModel = T> extends React.PureComponent<PowerGridProps<T, H>> {
  static defaultProps: Partial<PowerGridProps<CellViewModel>> = {
    role: 'grid',
  };

  private cachedGridMeta: GridMeta;
  private currentScrollPosition: Position = { x: 0, y: 0 };
  private scrollTimeout: number;

  protected mainGridRef = React.createRef<HTMLDivElement>();
  protected shadowGridRef = React.createRef<HTMLDivElement>();
  protected isUpdating: boolean = false;
  protected isScrolling: boolean = false;
  protected isDirty: boolean = false;
  
  componentDidMount(): void {
    this.startUpdateLoop();
  }

  render(): React.ReactNode {
    const { role, viewModel } = this.props;
    const gridMeta: GridMeta = this.getGridMeta(viewModel, this.currentScrollPosition);
    this.cachedGridMeta = gridMeta;
    const maxCells = viewModel.maxCellsWhileScrolling && viewModel.maxCellsWhileScrolling >= 0 && this.isScrolling ?
      viewModel.maxCellsWhileScrolling :
      Number.POSITIVE_INFINITY;

    const viewportCells = this.getViewportCells(viewModel, gridMeta, maxCells);
    const reactViewportRows: React.ReactNode[] = [];
    let rowCells: React.ReactNode[] = [];

    viewportCells.forEach((cell: InternalCell, i) => {
      // row headers
      if (viewModel.headers?.rowHeader && rowCells.length === 0) {
        const rowIndex = cell.row;
        viewModel.headers.rowHeader.cells[rowIndex].forEach((rowHeaderCell, i) => {
          rowCells.push(this.renderCell({ ...rowHeaderCell, row: cell.row, col: i } as InternalCell, gridMeta, CellType.RowHeader));
        });
      }
      rowCells.push(this.renderCell(cell, gridMeta));
      const nextCell = viewportCells[i + 1] as InternalCell;
      // create new row if the next cell is in a different row or on last cell
      if (!nextCell || nextCell.row !== cell.row) {
        // row footers
        if (viewModel.footers?.rowFooter) {
          const rowIndex = cell.row;
          viewModel.footers.rowFooter.cells[rowIndex].forEach((rowFooterCell, i) => {
            rowCells.push(this.renderCell({ ...rowFooterCell, row: cell.row, col: i } as InternalCell, gridMeta, CellType.RowFooter));
          });
        }
        const reactRow = <GridRow role="row" aria-rowindex={cell.row + 1} key={cell.row}>{rowCells}</GridRow>;
        reactViewportRows.push(reactRow);
        rowCells = [];
      }
    });
    
    // column headers
    let columnHeader: React.ReactNode= null;
    if (viewModel.headers?.colHeader) {
      const startCell = viewportCells[0] as InternalCell;
      const endCell = viewportCells[viewportCells.length - 1] as InternalCell;
      // console.log(`Visible Range: [${startCell.col}, ${startCell.row}] - [${endCell.col}, ${endCell.row}]`);
      
      columnHeader = (
        <thead role="rowgroup">
          {viewModel.headers.colHeader.cells.map((row, i) => (
            <GridRow key={`header_${i}`} role="row">
              {this.renderColHeaderIntersectionCells(i, gridMeta, CellType.HeaderIntersectionLeft)}
              {row.slice(startCell.col, endCell.col + 1).map((cell, j) =>
                this.renderCell({ ...cell, row: i, col: j + startCell.col } as InternalCell, gridMeta, CellType.ColumnHeader)
              )}
              {this.renderColHeaderIntersectionCells(i, gridMeta, CellType.HeaderIntersectionRight)}
            </GridRow>
          ))}
        </thead>
      );
    }
    
    // column footers
    let columnFooter: React.ReactNode= null;
    if (viewModel.footers?.colFooter) {
      const startCell = viewportCells[0] as InternalCell;
      const endCell = viewportCells[viewportCells.length - 1] as InternalCell;
      // console.log(`Visible Range: [${startCell.col}, ${startCell.row}] - [${endCell.col}, ${endCell.row}]`);
      
      columnFooter = (
        <tfoot role="rowgroup">
          {viewModel.footers.colFooter.cells.map((row, i) => (
            <GridRow key={`footer_${i}`} role="row">
              {this.renderColFooterIntersectionCells(i, gridMeta, CellType.FooterIntersectionLeft)}
              {row.slice(startCell.col, endCell.col + 1).map((cell, j) =>
                this.renderCell({ ...cell, row: i, col: j + startCell.col } as InternalCell, gridMeta, CellType.ColumnFooter)
              )}
              {this.renderColFooterIntersectionCells(i, gridMeta, CellType.FooterIntersectionRight)}
            </GridRow>
          ))}
        </tfoot>
      );
    }

    let viewportWidth = viewModel.width;
    if (!viewModel.hideScrollbars) {
      viewportWidth -= SCROLLBAR_SIZE;
    }

    let viewportHeight = viewModel.height;
    if (!viewModel.hideScrollbars) {
      viewportHeight -= SCROLLBAR_SIZE;
    }

    return(
      <Container
        ref={this.mainGridRef}
        onScroll={this.handleScroll}
        onWheel={this.handleWheel}
        style={{
          width: `${viewModel.width}px`,
          height: `${viewModel.height}px`,
        }}
      >
        <ShadowGrid
          colHeaderHeight={gridMeta.totalColHeaderHeight}
          rowHeaderWidth={gridMeta.totalRowHeaderWidth}
          // colFooterHeight={gridMeta.totalColFooterHeight}
          // rowFooterWidth={gridMeta.totalRowFooterWidth}
          hideScrollbars={viewModel.hideScrollbars}
          ref={this.shadowGridRef}
        >
          <ShadowGridContent style={{ width: `${gridMeta.innerWidth}px`, height: `${gridMeta.innerHeight}px` }} />
        </ShadowGrid>
        <GridViewport
          aria-colcount={gridMeta.colWidths.length}
          aria-rowcount={gridMeta.rowHeights.length}
          role={role}
          style={{
            width: `${viewportWidth}px`,
            height: `${viewportHeight}px`,
          }}
        >
          {columnHeader}
          <tbody role="rowgroup">
            {reactViewportRows}
          </tbody>
          {columnFooter}
        </GridViewport>
      </Container>
    )
  }
  
  componentDidUpdate(): void {
    const shadowGridEl = this.shadowGridRef.current!;
    shadowGridEl.scrollLeft = this.currentScrollPosition.x;
    shadowGridEl.scrollTop = this.currentScrollPosition.y;
  }
  
  componentWillUnmount(): void {
    this.stopUpdateLoop();
    clearTimeout(this.scrollTimeout);
  }
  
  private readonly renderCell = (cell: InternalCell, gridMeta: GridMeta, cellType: CellType = CellType.GridCell): React.ReactNode => {
    const { onCellClick, viewModel } = this.props;
    const cellMeta = this.getCellMeta(viewModel, gridMeta, cell as Cell<T>, cell.row, cell.col, cellType);
    const x = cellMeta.x - gridMeta.x;
    const y = cellMeta.y - gridMeta.y;
    const { height, width } = cellMeta;
    
    const Cell = cellType === CellType.GridCell ? GridCell : GridHeaderCell;
    const InnerCell = cell.renderer;
    
    let zIndex: number | undefined = undefined;
    if (cellType === CellType.HeaderIntersectionLeft ||
      cellType === CellType.HeaderIntersectionRight ||
      cellType === CellType.FooterIntersectionLeft ||
      cellType === CellType.FooterIntersectionRight) {
      zIndex = 2;
    }
    
    return (
      <Cell
        // role={cellType}
        aria-colindex={cellType !== CellType.RowHeader && cellType !== CellType.RowFooter ? cell.col + 1 : undefined}
        aria-rowindex={cellType !== CellType.ColumnHeader && cellType !== CellType.ColumnFooter ? cell.row + 1 : undefined}
        colSpan={cell.colspan}
        rowSpan={cell.rowspan}
        key={`${cellType}-${cell.row}-${cell.col}`}
        width={width}
        height={height}
        style={{
          zIndex,
          transform: `translate(${x}px, ${y}px)`,
        }}
      >
        <InnerCell
          {...cell}
          width={width}
          height={height}
          x={x}
          y={y}
          onClick={onCellClick}
        />
      </Cell>
    );
  };
  
  // TODO: consolidate w/ footer method
  private readonly renderColHeaderIntersectionCells = (
    row: number,
    gridMeta: GridMeta,
    cellType: CellType.HeaderIntersectionLeft | CellType.HeaderIntersectionRight,
  ): React.ReactNode => {
    const { viewModel: { headers, footers } } = this.props;
    
    const intersectionAxis = cellType === CellType.HeaderIntersectionLeft ? headers?.rowHeader : footers?.rowFooter;
    if (headers?.colHeader && intersectionAxis) {
      const intersections = cellType == CellType.HeaderIntersectionLeft ? headers?.leftIntersections : headers?.rightIntersections;
      return intersectionAxis.widths.map((width, col) => {
        let cell: Partial<InternalCell> = {
          renderer: () => <div style={{ backgroundColor: '#fff', height: '100%', }} />,
        };
        if (intersections &&
          intersections[row] &&
          intersections[row][col]) {
          cell = intersections[row][col];
        }
        return this.renderCell({ ...cell, row, col } as InternalCell, gridMeta, cellType);
      });
    }
    return null;
  };
  
  private readonly renderColFooterIntersectionCells = (
    row: number,
    gridMeta: GridMeta,
    cellType: CellType.FooterIntersectionLeft | CellType.FooterIntersectionRight,
  ): React.ReactNode => {
    const { viewModel: { headers, footers } } = this.props;
    
    const intersectionAxis = cellType === CellType.FooterIntersectionLeft ? headers?.rowHeader : footers?.rowFooter;
    if (footers?.colFooter && intersectionAxis) {
      return intersectionAxis.widths.map((width, col) => {
        let cell: Partial<InternalCell> = {
          renderer: () => <div style={{ backgroundColor: '#fff', height: '100%', }} />,
        };
        const intersections = cellType == CellType.FooterIntersectionLeft ? footers?.leftIntersections : footers?.rightIntersections;
        if (intersections &&
          intersections[row] &&
          intersections[row][col]) {
          cell = intersections[row][col];
        }
        return this.renderCell({ ...cell, row, col } as InternalCell, gridMeta, cellType);
      });
    }
    return null;
  };
  
  private readonly handleScroll = (evt: React.UIEvent<HTMLDivElement>) => {
    const shadowGridEl = this.shadowGridRef.current!;
    this.onScroll({
      x: shadowGridEl.scrollLeft,
      y: shadowGridEl.scrollTop,
    });
  };
  
  private readonly handleWheel = (evt: React.WheelEvent<HTMLDivElement>) => {
    this.onScroll({
      x: this.currentScrollPosition.x + evt.deltaX,
      y: this.currentScrollPosition.y + evt.deltaY,
    });
  };
  
  private readonly onScroll = (targetScrollPosition: Position): void => { 
    const viewModel = this.props.viewModel;
    const gridMeta = this.cachedGridMeta;
    const minX = 0;
    const minY = 0;
    const maxX = gridMeta.innerWidth - viewModel.width + SCROLLBAR_SIZE;
    const maxY = gridMeta.innerHeight - viewModel.height + SCROLLBAR_SIZE;
    
    const normalizedScrollPosition: Position = {
      x: Math.min(Math.max(minX, targetScrollPosition.x), maxX),
      y: Math.min(Math.max(minY, targetScrollPosition.y), maxY),
    };
    
    if (this.currentScrollPosition.x !== normalizedScrollPosition.x || this.currentScrollPosition.y !== normalizedScrollPosition.y) {
      this.currentScrollPosition = normalizedScrollPosition;

      if (this.props.onScroll) {
        this.props.onScroll(this.currentScrollPosition);
      }

      this.setScrolling();
      this.isDirty = true;
    }
  };
  
  private readonly startUpdateLoop = (): void => {
    if (!this.isUpdating) {
      this.isUpdating = true;
      this.update();
    }
  };
  
  private readonly stopUpdateLoop = (): void => {
    this.isUpdating = false;
  };
  
  private readonly update = (): void => {
    if (this.isDirty) {
      this.forceUpdate();
      this.isDirty = false;
    }
    if (this.isUpdating) {
      requestAnimationFrame(() => {
        this.update();
      });
    }
  };
  
  private readonly setScrolling = (): void => {
    this.isScrolling = true;
    clearTimeout(this.scrollTimeout);
    this.scrollTimeout = window.setTimeout(() => {
      this.isScrolling = false;
      this.isDirty = true;
    }, 100);
  };
  
  
  // *************************

  private readonly getStarts = (sizes: number[], offset: number = 0): number[] => {
    const starts: number[] = [];
    let start = offset;
    sizes.forEach((size, n) => {
      starts[n] = start;
      start += size;
    });
  
    return starts;
  }
  
  private readonly getCellMeta = (
    viewModel: GridViewModel<T, H>,
    gridMeta: GridMeta,
    cell: Cell<T>,
    row: number,
    col: number,
    cellType: CellType = CellType.GridCell
  ): CellMeta => {
    const gridX = gridMeta.x;
    const gridY = gridMeta.y;
    const gridWidth = viewModel.width; // - gridMeta.totalRowHeaderWidth - gridMeta.totalRowFooterWidth;
    const gridHeight = viewModel.height; // + gridMeta.totalColHeaderHeight + gridMeta.totalColFooterHeight;
    let x = gridMeta.colStarts[col];
    let y = gridMeta.rowStarts[row];
    
    // TODO: accommodate varying row/col heights/widths
    switch (cellType) {
      case CellType.ColumnHeader:
        y = row * gridMeta.colHeaderHeights[row] + gridY;
        break;
      case CellType.ColumnFooter:
        y = gridY + gridHeight - ((row + 1) * gridMeta.colFooterHeights[row]) - SCROLLBAR_SIZE;
        break;
      case CellType.RowHeader:
        x = col * gridMeta.rowHeaderWidths[col] + gridX;
        break;
      case CellType.RowFooter:
        x = gridX + gridWidth - ((col + 1) * gridMeta.rowFooterWidths[col]) - SCROLLBAR_SIZE;
        break;
      case CellType.HeaderIntersectionLeft:
        x = viewModel.headers!.rowHeader!.widths.slice(0, col).reduce((ttl, x) => ttl += x, 0) + gridX;
        y = viewModel.headers!.colHeader!.heights.slice(0, row).reduce((ttl, y) => ttl += y, 0) + gridY;
        break;
      case CellType.HeaderIntersectionRight:
        x = gridX + gridWidth - viewModel.footers!.rowFooter!.widths.slice(0, col + 1).reduce((ttl, x) => ttl += x, 0)  - SCROLLBAR_SIZE;
        y = viewModel.headers!.colHeader!.heights.slice(0, row).reduce((ttl, y) => ttl += y, 0) + gridY;
        break;
      case CellType.FooterIntersectionLeft:
        x = viewModel.headers!.rowHeader!.widths.slice(0, col).reduce((ttl, x) => ttl += x, 0) + gridX;
        y = gridY + gridHeight - viewModel.footers!.colFooter!.heights.slice(0, row + 1).reduce((ttl, y) => ttl += y, 0) - SCROLLBAR_SIZE;
        break;
      case CellType.FooterIntersectionRight:
        x = gridX + gridWidth - viewModel.footers!.rowFooter!.widths.slice(0, col + 1).reduce((ttl, x) => ttl += x, 0)  - SCROLLBAR_SIZE;
        y = gridY + gridHeight - viewModel.footers!.colFooter!.heights.slice(0, row + 1).reduce((ttl, y) => ttl += y, 0) - SCROLLBAR_SIZE;
        break;
    }
  
    let colspanRemaining = cell.colspan === undefined ? 1 : cell.colspan;
    let colspanCol = col;
    let width = 0;
    while (colspanRemaining > 0) {
      switch (cellType) {
        case CellType.GridCell:
        case CellType.ColumnHeader:
        case CellType.ColumnFooter:
          width += gridMeta.colWidths[colspanCol];
          break;
        case CellType.RowHeader:
          width += gridMeta.rowHeaderWidths[colspanCol];
          break;
        case CellType.RowFooter:
          width += gridMeta.rowFooterWidths[colspanCol];
          break;
        case CellType.HeaderIntersectionLeft:
          width += viewModel.headers!.rowHeader!.widths[colspanCol];
          break;
        case CellType.HeaderIntersectionRight:
          width += viewModel.footers!.rowFooter!.widths[colspanCol];
          break;
        case CellType.FooterIntersectionLeft:
          width += viewModel.headers!.rowHeader!.widths[colspanCol];
          break;
        case CellType.FooterIntersectionRight:
          width += viewModel.footers!.rowFooter!.widths[colspanCol];
          break;
      }
      colspanCol++;
      colspanRemaining--;
    }
  
    let rowspanRemaining = cell.rowspan === undefined ? 1 : cell.rowspan;
    let rowspanRow = row;
    let height = 0;
    while (rowspanRemaining > 0) {
      switch (cellType) {
        case CellType.GridCell:
        case CellType.RowHeader:
        case CellType.RowFooter:
          height += gridMeta.rowHeights[rowspanRow];
          break;
        case CellType.ColumnHeader:
          height += gridMeta.colHeaderHeights[rowspanRow];
          break;
        case CellType.ColumnFooter:
          height += gridMeta.colFooterHeights[rowspanRow];
          break;
        case CellType.HeaderIntersectionLeft:
        case CellType.HeaderIntersectionRight:
          height += viewModel.headers!.colHeader!.heights[rowspanRow];
          break;
        case CellType.FooterIntersectionLeft:
        case CellType.FooterIntersectionRight:
          height += viewModel.footers!.colFooter!.heights[rowspanRow];
          break;
      }
      rowspanRow++;
      rowspanRemaining--;
    }
  
    const visible = x + width >= gridX && x <= gridX + gridWidth && y + height >= gridY && y - height <= gridY + gridHeight;
  
    return {
      x,
      y,
      width,
      height,
      visible,
      // direction of cell relative to center of grid
      direction: {
        x: x > gridX + gridWidth/2 ? -1 : 1,
        y: y > gridY + gridHeight/2 ? -1 : 1
      }
    }
  };  

  // quickly find a cell that is visible in the viewport
  private readonly getStartCell = (viewModel: GridViewModel<T, H>, gridMeta: GridMeta): InternalCell => {
    // find cell near center;
    const numCols = gridMeta.colWidths.length;
    const numRows = gridMeta.rowHeights.length;
    let col = Math.floor(numCols/2);
    let row = Math.floor(numRows/2);
    let divider = 0.25;
    let startCell;
    
    while (true) {
      startCell = viewModel.cells[row][col] as InternalCell;

      if (startCell) {
        const startCellMeta = this.getCellMeta(viewModel, gridMeta, startCell as Cell<T>, row, col);

        // if we find a visible cell, we have found the start cell!
        if (startCellMeta.visible) {
          // warning: decorating view model in place
          startCell.row = row;
          startCell.col = col;
          break;
        }

        const direction = startCellMeta.direction;

        if (direction.x > 0) {
          col += Math.floor(numCols*divider);
        }
        else if (direction.x < 0) {
          col -= Math.floor(numCols*divider);
        }

        if (direction.y > 0) {
          row += Math.floor(numRows*divider);
        }
        else if (direction.y < 0) {
          row -= Math.floor(numRows*divider);
        }
      }
      // if we landed at a row/col position where there is no cell, look for another adjacent cell
      else {
        row += 1;
        col += 1;
      }

      divider /= 2;
    }

    //console.log('found visible cell in ' + bisectorCount + ' iterations');

    return startCell;
  }

  private readonly getViewportCells = (viewModel: GridViewModel<T, H>, gridMeta: GridMeta, maxCells: number): InternalCell[] => {
    const viewportCells = [];
    const numCols = gridMeta.colWidths.length;
    const numRows = gridMeta.rowHeights.length;
    const startCell = this.getStartCell(viewModel, gridMeta);
    const startCol = startCell.col;
    const startRow = startCell.row;
    let minCol = startCol;
    let maxCol = startCol;
    let minRow = startRow;
    let maxRow = startRow;
  
    while (true) {
      minCol--;
      if (minCol < 0) {
        minCol = 0;
        break;
      }
      const cell = viewModel.cells[startRow][minCol];
      if (cell) {
        const cellMeta = this.getCellMeta(viewModel, gridMeta, cell, startRow, minCol);
        if (!cellMeta.visible) {
          break;
        }
      }
    }
  
    while (true) {
      maxCol++;
      if (maxCol >= numCols-1) {
        maxCol = numCols-1;
        break;
      }
      const cell = viewModel.cells[startRow][maxCol];
      if (cell) {
        const cellMeta = this.getCellMeta(viewModel, gridMeta, cell, startRow, maxCol);
        if (!cellMeta.visible) {
          break;
        }
      }
    }
  
    while (true) {
      minRow--;
      if (minRow < 0) {
        minRow = 0;
        break;
      }
      const cell = viewModel.cells[minRow][startCol];
      if (cell) {
        const cellMeta = this.getCellMeta(viewModel, gridMeta, cell, minRow, startCol);
        if (!cellMeta.visible) {
          break;
        }
      }
    }
  
    while (true) {
      maxRow++;
      if (maxRow >= numRows-1) {
        maxRow = numRows-1;
        break;
      }
      const cell = viewModel.cells[maxRow][startCol];
      if (cell) {
        const cellMeta = this.getCellMeta(viewModel, gridMeta, cell, maxRow, startCol);
        if (!cellMeta.visible) {
          break;
        }
      }
    }
  
    let cellCount = 0;
    for (let r=minRow; r<=maxRow; r++) {
      for (let c=minCol; c<=maxCol; c++) {      
        cellCount++;
        if (cellCount <= maxCells) {
          const cell = viewModel.cells[r][c] as InternalCell;    
          if (cell) {
            // warning, decorating original view model in place
            cell.row = r;
            cell.col = c;
            viewportCells.push(cell);
          }
        }
      }
    }
  
    //console.log('rendering ' + viewportCells.length + ' cells');
    return viewportCells;
  };

  private readonly getGridMeta = (viewModel: GridViewModel<T, H>, scrollPosition: Position): GridMeta => {
    const colHeaderHeights = viewModel.headers?.colHeader?.heights ?? [];
    const totalColHeaderHeight = viewModel.headers?.colHeader ? viewModel.headers.colHeader.heights.reduce((ttl, h) => ttl += h, 0) : 0;
    const rowHeaderWidths = viewModel.headers?.rowHeader?.widths ?? [];
    const totalRowHeaderWidth = viewModel.headers?.rowHeader ? viewModel.headers.rowHeader.widths.reduce((ttl, w) => ttl += w, 0) : 0;
    
    const colFooterHeights = viewModel.footers?.colFooter?.heights ?? [];
    const totalColFooterHeight = viewModel.footers?.colFooter ? viewModel.footers.colFooter.heights.reduce((ttl, h) => ttl += h, 0) : 0;
    const rowFooterWidths = viewModel.footers?.rowFooter?.widths ?? [];
    const totalRowFooterWidth = viewModel.footers?.rowFooter ? viewModel.footers.rowFooter.widths.reduce((ttl, w) => ttl += w, 0) : 0;
    
    const colWidths = viewModel.colWidths;
    const rowHeights = viewModel.rowHeights;
    const colStarts = this.getStarts(colWidths, totalRowHeaderWidth);
    const rowStarts = this.getStarts(rowHeights, totalColHeaderHeight);
    const innerWidth = colStarts[colStarts.length-1] + colWidths[colWidths.length-1]; // TODO: account for headers and footers
    const innerHeight = rowStarts[rowStarts.length-1] + rowHeights[rowHeights.length-1];
  
    return {
      colWidths,
      rowHeights,
      colStarts,
      rowStarts,
      innerWidth,
      innerHeight,
      colHeaderHeights,
      totalColHeaderHeight,
      rowHeaderWidths,
      totalRowHeaderWidth,
      colFooterHeights,
      totalColFooterHeight,
      rowFooterWidths,
      totalRowFooterWidth,
      x: scrollPosition.x,
      y: scrollPosition.y,
    };
  };
}

export default PowerGrid;
